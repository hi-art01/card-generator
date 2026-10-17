'use client';

import React, { useMemo, useRef, useState } from 'react';
import { Card, CardData } from './Card';
import { usePersistentState } from '../lib/usePersistentState';
import { getAiConfigFromStorage } from '../lib/aiProvider';

export type TopicMode = 'contention' | 'rebuttal' | 'both';
export type SidePreference = 'both' | 'aff' | 'neg';

export interface TopicCardData extends CardData {
  cardMode?: 'contention' | 'rebuttal';
  strategyTarget?: string;
}

interface AngleDefinition {
  mode: 'contention' | 'rebuttal';
  side: 'AFF' | 'NEG';
  claim: string;
  role: string;
}

interface TopicCardCutterTabProps {
  topic?: string;
  onCardsUpdate?: (cards: CardData[]) => void;
}

function parseTargetUrls(rawValue: string): string[] {
  if (!rawValue) return [];
  const entries = rawValue
    .split(/[\n,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);

  const validUrls: string[] = [];
  for (const entry of entries) {
    const candidate = /^https?:\/\//i.test(entry) ? entry : `https://${entry}`;
    try {
      const parsed = new URL(candidate);
      if (['http:', 'https:'].includes(parsed.protocol) && parsed.hostname.includes('.')) {
        validUrls.push(parsed.href);
      }
    } catch {
      // Ignore invalid URLs
    }
  }

  return Array.from(new Set(validUrls));
}

export function TopicCardCutterTab({ topic: initialTopic = '', onCardsUpdate }: TopicCardCutterTabProps) {
  const [topic, setTopic] = usePersistentState('debate_topic_cutter_topic', initialTopic || '');
  const [targetUrl, setTargetUrl] = usePersistentState('debate_topic_cutter_target_urls', '');
  const [mode, setMode] = usePersistentState<TopicMode>('debate_topic_cutter_mode', 'both');
  const [sidePreference, setSidePreference] = usePersistentState<SidePreference>('debate_topic_cutter_side', 'both');
  const [cardCount, setCardCount] = usePersistentState('debate_topic_cutter_count', 6);
  const [untilStopped, setUntilStopped] = usePersistentState('debate_topic_cutter_until_stopped', true);

  const [loading, setLoading] = useState(false);
  const [statusText, setStatusText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<TopicCardData[]>([]);
  const [, setAngles] = useState<AngleDefinition[]>([]);
  const [targetedSitesUsed, setTargetedSitesUsed] = useState<string[]>([]);
  const [filterMode, setFilterMode] = useState<'all' | 'contention' | 'rebuttal' | 'aff' | 'neg'>('all');
  const [allCopied, setAllCopied] = useState(false);
  const activeRequest = useRef<AbortController | null>(null);

  // Parse target URLs for live count badge
  const parsedTargetUrls = useMemo(() => parseTargetUrls(targetUrl), [targetUrl]);
  const parsedTargetUrlsCount = parsedTargetUrls.length;

  // Sync if parent passes non-empty topic and local topic is empty
  React.useEffect(() => {
    if (initialTopic && !topic) {
      setTopic(initialTopic);
    }
  }, [initialTopic, topic, setTopic]);

  const handleCutCards = async (e: React.FormEvent) => {
    e.preventDefault();
    if (activeRequest.current) {
      activeRequest.current.abort();
      activeRequest.current = null;
      setLoading(false);
      setStatusText('Stopping after the current request…');
      return;
    }
    if (!topic.trim()) {
      setError('Please provide a debate topic to cut cards for.');
      return;
    }

    setLoading(true);
    setError(null);
    setResults([]);
    setAngles([]);
    setTargetedSitesUsed([]);
    const controller = new AbortController();
    activeRequest.current = controller;
    let finalStatus = '';

    if (parsedTargetUrlsCount > 0) {
      setStatusText(
        `Deep Cut Mode: Downloading and extracting evidence from ${parsedTargetUrlsCount} targeted website(s)...`
      );
    } else {
      setStatusText('Analyzing debate topic & brainstorming high-yield arguments...');
    }

    try {
      const configuredKeys = getAiConfigFromStorage('navigator', false).apiKeys ?? [];

      let keyIndex = 0;
      const seenCards = new Set<string>();
      const seenSourceUrls = new Set<string>();
      let totalCards = 0;
      let cycle = 0;
      let emptyRounds = 0;
      while (!controller.signal.aborted) {
        const aiConfig = getAiConfigFromStorage('navigator');
        if (aiConfig.apiKey) keyIndex += 1;
        setStatusText(`Cutting cards continuously · ${totalCards} added · ${aiConfig.providerMode === 'local' ? 'local model' : configuredKeys.length ? `API key ${Math.min(keyIndex, configuredKeys.length)} of ${configuredKeys.length}` : 'cloud provider'}`);
        const res = await fetch('/api/topic-cards', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            topic: topic.trim(),
            targetUrls: targetUrl.trim(),
            mode,
            sidePreference,
            cardCount,
            cycle,
            excludeUrls: [...seenSourceUrls],
            ...aiConfig,
          }),
        });
        const data = await res.json();
        if (res.status === 429 || data.quotaExhausted) {
          if (aiConfig.apiKey) continue;
          finalStatus = aiConfig.providerMode === 'local'
            ? 'The local model could not complete this request.'
            : 'API keys are exhausted.';
          break;
        }
        if (res.status === 422 && untilStopped) {
          emptyRounds += 1;
          cycle += 1;
          setStatusText(`No usable evidence in this search round (${emptyRounds}/3). Trying a different search…`);
          if (emptyRounds < 3) continue;
          finalStatus = totalCards
            ? `Stopped after three empty rounds. Kept the ${totalCards} cards already cut.`
            : data.error || 'No usable sources were found after three search rounds.';
          if (totalCards === 0) setError(finalStatus);
          break;
        }
        if (!res.ok) throw new Error(data.error || 'Failed to cut cards for topic.');

        const freshCards: TopicCardData[] = (data.cards || []).filter((card: TopicCardData) => {
          const fingerprint = `${card.citation}|${card.bodyHtml.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()}`;
          if (seenCards.has(fingerprint)) return false;
          seenCards.add(fingerprint);
          return true;
        });
        const sourceUrls: string[] = Array.isArray(data.sourceUrls)
          ? data.sourceUrls.filter((sourceUrl: unknown): sourceUrl is string => typeof sourceUrl === 'string')
          : [];
        sourceUrls.forEach((sourceUrl) => seenSourceUrls.add(sourceUrl));
        if (freshCards.length) {
          totalCards += freshCards.length;
          emptyRounds = 0;
          setResults((previous) => [...previous, ...freshCards]);
          onCardsUpdate?.(freshCards);
        } else {
          emptyRounds += 1;
        }
        (data.cards || []).forEach((card: TopicCardData) => {
          if (card.sourceUrl) seenSourceUrls.add(card.sourceUrl);
        });
        cycle += 1;
        setAngles(data.angles || []);
        setTargetedSitesUsed(data.targetedWebsites || []);
        if (untilStopped && emptyRounds >= 3) {
          finalStatus = totalCards
            ? `Stopped after three rounds without new cards. Kept all ${totalCards} cards.`
            : data.notice || 'No cards passed source and relevance checks after three rounds.';
          if (totalCards === 0) setError(finalStatus);
          break;
        }
        if (!untilStopped && !freshCards.length) {
          setError(data.notice || 'No cards could be cut. Try rephrasing the topic or broadening your search.');
          break;
        }
        if (!untilStopped) {
          finalStatus = `Done! Cut ${totalCards} cards.`;
          break;
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        finalStatus = 'Stopped.';
      } else {
        console.error('Error in TopicCardCutterTab:', err);
        setError(err instanceof Error ? err.message : 'Error cutting topic cards.');
      }
    } finally {
      activeRequest.current = null;
      setLoading(false);
      setStatusText(finalStatus);
    }
  };

  const handleCopyAll = async () => {
    if (results.length === 0) return;

    const plainText = results
      .map((card) => {
        const body = card.bodyHtml
          .replace(/<br\s*\/?>/gi, '\n')
          .replace(/<\/(p|div)>/gi, '\n')
          .replace(/<[^>]+>/g, '')
          .replace(/\n{3,}/g, '\n\n')
          .trim();
        return [card.tag, card.citation, body].filter(Boolean).join('\n');
      })
      .join('\n\n────────────────────\n\n');

    const html = results
      .map((card) => {
        const formattedBody = card.bodyHtml
          .replace(/<mark>/g, '<mark style="background-color:#fff200;color:#332b27;font-weight:normal;">')
          .replace(/<u>/g, '<u style="text-decoration:underline;color:#000;font-size:8pt;">');
        return `<section style="font-family:Arial,sans-serif;color:#000;margin:0 0 24px;">${card.tag ? `<h3 style="margin:0 0 4px;font-size:13pt;">${card.tag}</h3>` : ''}<p style="margin:4px 0 12px;font-size:10pt;color:#333;"><i>${card.citation}</i></p><div style="font-size:8pt;line-height:1.5;color:#222;">${formattedBody}</div></section>`;
      })
      .join('<hr style="border:0;border-top:1px solid #ccc;margin:18px 0;">');

    try {
      if (navigator.clipboard && window.ClipboardItem) {
        await navigator.clipboard.write([
          new ClipboardItem({
            'text/html': new Blob([html], { type: 'text/html' }),
            'text/plain': new Blob([plainText], { type: 'text/plain' }),
          }),
        ]);
      } else {
        await navigator.clipboard.writeText(plainText);
      }
      setAllCopied(true);
      window.setTimeout(() => setAllCopied(false), 2000);
    } catch {
      try {
        await navigator.clipboard.writeText(plainText);
        setAllCopied(true);
        window.setTimeout(() => setAllCopied(false), 2000);
      } catch {
        setError('Could not copy to clipboard. Check clipboard permissions.');
      }
    }
  };

  const filteredCards = results.filter((card) => {
    if (filterMode === 'all') return true;
    if (filterMode === 'contention') return card.cardMode === 'contention';
    if (filterMode === 'rebuttal') return card.cardMode === 'rebuttal';
    if (filterMode === 'aff') return card.type === 'AFF' || card.tag.toUpperCase().includes('[AFF');
    if (filterMode === 'neg') return card.type === 'NEG' || card.tag.toUpperCase().includes('[NEG');
    return true;
  });

  const contentionCount = results.filter((c) => c.cardMode === 'contention').length;
  const rebuttalCount = results.filter((c) => c.cardMode === 'rebuttal').length;

  return (
    <section className="card-box animate-fade-in" style={{ padding: 'clamp(1.2rem, 3.5vw, 2.2rem)' }}>
      {/* Header */}
      <div style={{ marginBottom: '1.6rem' }}>
        <p style={{ margin: '0 0 0.35rem 0', fontFamily: 'var(--font-mono)', color: 'var(--muted-foreground)', fontSize: '0.72rem', fontWeight: 600, letterSpacing: '0.2em', textTransform: 'uppercase' }}>
          Topic Card Cutter · Broad Resolution
        </p>
        <h2 style={{ fontSize: '1.85rem', fontWeight: 600, fontStyle: 'italic', marginBottom: '0.45rem', letterSpacing: '-0.02em' }}>
          Topic Card Cutter
        </h2>
        <p style={{ color: 'var(--muted-foreground)', lineHeight: 1.55, margin: 0, fontSize: '0.92rem' }}>
          Cuts high-yield debate cards across an entire topic. Select whether you want cards for your constructive case, cards to refute opponent contentions, or both. Optionally specify targeted websites to deep-cut directly.
        </p>
      </div>

      {/* Main Form */}
      <form onSubmit={handleCutCards} style={{ display: 'flex', flexDirection: 'column', gap: '1.4rem' }}>
        {/* Row 1: Debate Topic & Specific Target URLs */}
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 340px' }}>
            <label style={{ display: 'block', fontSize: '0.9rem', color: 'var(--foreground)', fontWeight: 600, marginBottom: '0.4rem' }}>
              Debate Topic / Resolution *
            </label>
            <input
              type="text"
              placeholder="e.g. Resolved: The United States should adopt a Universal Basic Income"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              disabled={loading}
              style={{
                width: '100%',
                padding: '0.85rem 1rem',
                background: 'var(--input-bg)',
                border: '1px solid var(--card-border)',
                color: 'var(--foreground)',
                borderRadius: '8px',
                fontSize: '1rem',
              }}
            />
          </div>

          <div style={{ flex: '1 1 340px' }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '0.4rem',
                flexWrap: 'wrap',
                gap: '0.5rem',
              }}
            >
              <label style={{ fontSize: '0.9rem', color: 'var(--foreground)', fontWeight: 600 }}>
                Specific Target URLs (Optional)
              </label>
              {parsedTargetUrlsCount > 0 && (
                <span
                  style={{
                    fontSize: '0.75rem',
                    padding: '0.15rem 0.55rem',
                    borderRadius: '999px',
                    background: 'var(--accent)',
                    color: 'var(--accent-foreground)',
                    border: '1px solid var(--border)',
                    fontWeight: 600,
                  }}
                >
                  ✓ {parsedTargetUrlsCount} {parsedTargetUrlsCount === 1 ? 'URL' : 'URLs'} configured (Deep Cut Mode)
                </span>
              )}
            </div>
            <textarea
              value={targetUrl}
              onChange={(e) => setTargetUrl(e.target.value)}
              placeholder="Paste one or multiple URLs (one per line or comma-separated) to deep-cut specific websites instead of searching Google..."
              rows={3}
              disabled={loading}
              style={{
                width: '100%',
                padding: '0.8rem',
                background: 'var(--input-bg)',
                border: '1px solid var(--card-border)',
                color: 'var(--foreground)',
                borderRadius: '8px',
                resize: 'vertical',
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                fontSize: '0.88rem',
                lineHeight: 1.4,
              }}
            />
          </div>
        </div>

        {/* 3 Modes Selection */}
        <div>
          <label style={{ display: 'block', fontSize: '0.9rem', color: 'var(--foreground)', fontWeight: 600, marginBottom: '0.6rem' }}>
            Select Card Cutting Mode *
          </label>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
              gap: '1rem',
            }}
          >
            {/* Mode 1: Contention */}
            <button
              type="button"
              aria-pressed={mode === 'contention'}
              disabled={loading}
              className="topic-mode-option"
              onClick={() => setMode('contention')}
              style={{
                padding: '1.1rem',
                borderRadius: '10px',
                border: mode === 'contention' ? '2px solid var(--primary)' : '1px solid var(--card-border)',
                background: mode === 'contention' ? 'var(--accent)' : 'var(--card)',
                transition: 'all 0.2s ease',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.4rem' }}>
                <span style={{ fontSize: '1.25rem' }}>📑</span>
                <span style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--foreground)' }}>
                  Contention Mode
                </span>
              </div>
              <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--muted-foreground)', lineHeight: 1.4 }}>
                <b>Case Builder:</b> Cuts proactive cards designed for constructive speeches (1AC / 1NC advantages, disadvantages, solvency mechanisms, quantified impacts).
              </p>
            </button>

            {/* Mode 2: Rebuttal */}
            <button
              type="button"
              aria-pressed={mode === 'rebuttal'}
              disabled={loading}
              className="topic-mode-option"
              onClick={() => setMode('rebuttal')}
              style={{
                padding: '1.1rem',
                borderRadius: '10px',
                border: mode === 'rebuttal' ? '2px solid var(--primary)' : '1px solid var(--card-border)',
                background: mode === 'rebuttal' ? 'var(--accent)' : 'var(--card)',
                transition: 'all 0.2s ease',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.4rem' }}>
                <span style={{ fontSize: '1.25rem' }}>🛡️</span>
                <span style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--foreground)' }}>
                  Rebuttal Mode
                </span>
              </div>
              <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--muted-foreground)', lineHeight: 1.4 }}>
                <b>Refutation & Defense:</b> Cuts cards designed to respond to contentions (link turns, solvency takeouts, impact defense, counter-warrants against standard claims).
              </p>
            </button>

            {/* Mode 3: Both */}
            <button
              type="button"
              aria-pressed={mode === 'both'}
              disabled={loading}
              className="topic-mode-option"
              onClick={() => setMode('both')}
              style={{
                padding: '1.1rem',
                borderRadius: '10px',
                border: mode === 'both' ? '2px solid var(--primary)' : '1px solid var(--card-border)',
                background: mode === 'both' ? 'var(--accent)' : 'var(--card)',
                transition: 'all 0.2s ease',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.4rem' }}>
                <span style={{ fontSize: '1.25rem' }}>⚡</span>
                <span style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--foreground)' }}>
                  Both (Case & Rebuttal)
                </span>
              </div>
              <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--muted-foreground)', lineHeight: 1.4 }}>
                <b>Complete Arsenal:</b> Balanced delivery featuring both core constructive contention cards and lethal rebuttal response cards.
              </p>
            </button>
          </div>
        </div>

        {/* Options Row: Side Preference & Card Count */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--foreground)', fontWeight: 600, marginBottom: '0.4rem' }}>
              Side Focus:
            </label>
            <select
              value={sidePreference}
              onChange={(e) => setSidePreference(e.target.value as SidePreference)}
              disabled={loading}
              style={{
                width: '100%',
                padding: '0.65rem 0.8rem',
                background: 'var(--input-bg)',
                border: '1px solid var(--card-border)',
                color: 'var(--foreground)',
                borderRadius: '8px',
              }}
            >
              <option value="both">Both Sides (Aff & Neg)</option>
              <option value="aff">Affirmative (AFF) Focus</option>
              <option value="neg">Negative (NEG) Focus</option>
            </select>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--foreground)', fontWeight: 600, marginBottom: '0.4rem' }}>
              Cards per batch:
            </label>
            <select
              value={untilStopped ? 'until-stopped' : cardCount}
              onChange={(e) => {
                if (e.target.value === 'until-stopped') {
                  setUntilStopped(true);
                } else {
                  setUntilStopped(false);
                  setCardCount(Number(e.target.value));
                }
              }}
              disabled={loading}
              style={{
                width: '100%',
                padding: '0.65rem 0.8rem',
                background: 'var(--input-bg)',
                border: '1px solid var(--card-border)',
                color: 'var(--foreground)',
                borderRadius: '8px',
              }}
            >
              <option value={4}>4 High-Yield Cards</option>
              <option value={6}>6 Comprehensive Cards</option>
              <option value={8}>8 Deep Cards</option>
              <option value={12}>12 Maximum Cards</option>
              <option value="until-stopped">Until I stop</option>
            </select>
          </div>
        </div>

        {/* Submit Button */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
          {loading && (
            <button type="button" onClick={() => activeRequest.current?.abort()} className="btn-secondary" style={{ padding: '0.7rem 1.2rem', color: 'var(--destructive)', borderColor: 'var(--destructive)' }}>
              Stop Cutting
            </button>
          )}
          {results.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setResults([]);
                setAngles([]);
                setTargetedSitesUsed([]);
                setError(null);
              }}
              disabled={loading}
              style={{
                padding: '0.7rem 1.2rem',
                borderRadius: '8px',
                background: 'var(--secondary)',
                border: '1px solid var(--card-border)',
                color: 'var(--foreground)',
                cursor: 'pointer',
                fontWeight: 600,
              }}
            >
              Clear
            </button>
          )}

          <button
            type="submit"
            disabled={!loading && !topic.trim()}
            className="btn-primary"
            style={{
              padding: '0.75rem 1.6rem',
              fontSize: '0.95rem',
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
            }}
          >
            {loading ? 'Stop cutting' : parsedTargetUrlsCount > 0 ? '⚡ Deep-Cut Targeted Sites' : '⚡ Cut Topic Cards'}
          </button>
        </div>
      </form>

      {/* Loading Progress */}
      {loading && (
        <div
          style={{
            marginTop: '1.5rem',
            padding: '1.25rem',
            borderRadius: '10px',
            background: 'var(--accent)',
            border: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            gap: '1rem',
          }}
        >
          <div
            style={{
              width: '24px',
              height: '24px',
              border: '3px solid var(--border)',
              borderTopColor: 'var(--primary)',
              borderRadius: '50%',
              animation: 'spin 1s linear infinite',
            }}
          />
          <span style={{ color: 'var(--foreground)', fontSize: '0.92rem', fontWeight: 500 }}>
            {statusText || 'Processing...'}
          </span>
        </div>
      )}

      {/* Error Message */}
      {error && !loading && (
        <div
          style={{
            marginTop: '1.5rem',
            padding: '0.9rem',
            background: 'color-mix(in oklch, var(--destructive) 10%, var(--card))',
            border: '1px solid color-mix(in oklch, var(--destructive) 35%, var(--border))',
            color: 'var(--destructive)',
            borderRadius: '8px',
            fontSize: '0.9rem',
          }}
        >
          {error}
        </div>
      )}

      {/* Results View */}
      {!loading && results.length > 0 && (
        <div style={{ marginTop: '2rem' }}>
          {/* Action & Stats Bar */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '1rem',
              flexWrap: 'wrap',
              gap: '0.8rem',
              padding: '0.75rem 1rem',
              background: 'var(--secondary)',
              borderRadius: '10px',
              border: '1px solid var(--card-border)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem', flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 700, color: 'var(--foreground)', fontSize: '0.95rem' }}>
                Found {results.length} Cards
              </span>
              <span style={{ fontSize: '0.8rem', color: 'var(--muted-foreground)' }}>
                ({contentionCount} Contention · {rebuttalCount} Rebuttal)
              </span>
              {targetedSitesUsed.length > 0 && (
                <span
                  style={{
                    fontSize: '0.75rem',
                    padding: '0.15rem 0.5rem',
                    borderRadius: '999px',
                    background: 'var(--accent)',
                    color: 'var(--accent-foreground)',
                    border: '1px solid var(--border)',
                    fontWeight: 600,
                  }}
                >
                  🎯 Deep-Cut from {targetedSitesUsed.length} Targeted Site(s)
                </span>
              )}
            </div>

            <button
              onClick={handleCopyAll}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
                padding: '0.5rem 1rem',
                borderRadius: '8px',
                background: allCopied ? 'var(--accent)' : 'var(--card)',
                border: '1px solid var(--border)',
                color: allCopied ? 'var(--primary)' : 'var(--foreground)',
                cursor: 'pointer',
                fontWeight: 600,
                fontSize: '0.85rem',
                transition: 'all 0.2s ease',
              }}
              className="btn-secondary"
            >
              <span>{allCopied ? '✓' : '📋'}</span>
              <span>{allCopied ? 'Copied to Clipboard!' : 'Copy All Cards (Docs / Word)'}</span>
            </button>
          </div>

          {/* Filter Tabs */}
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
            <button
              onClick={() => setFilterMode('all')}
              style={{
                padding: '0.4rem 0.85rem',
                borderRadius: '6px',
                background: filterMode === 'all' ? 'var(--primary)' : 'var(--secondary)',
                color: filterMode === 'all' ? 'var(--primary-foreground)' : 'var(--muted-foreground)',
                border: 'none',
                cursor: 'pointer',
                fontWeight: 600,
                fontSize: '0.82rem',
              }}
            >
              All ({results.length})
            </button>

            {contentionCount > 0 && (
              <button
                onClick={() => setFilterMode('contention')}
                style={{
                  padding: '0.4rem 0.85rem',
                  borderRadius: '6px',
                  background: filterMode === 'contention' ? 'var(--primary)' : 'var(--secondary)',
                  color: filterMode === 'contention' ? 'var(--primary-foreground)' : 'var(--muted-foreground)',
                  border: 'none',
                  cursor: 'pointer',
                  fontWeight: 600,
                  fontSize: '0.82rem',
                }}
              >
                📑 Contention ({contentionCount})
              </button>
            )}

            {rebuttalCount > 0 && (
              <button
                onClick={() => setFilterMode('rebuttal')}
                style={{
                  padding: '0.4rem 0.85rem',
                  borderRadius: '6px',
                  background: filterMode === 'rebuttal' ? 'var(--primary)' : 'var(--secondary)',
                  color: filterMode === 'rebuttal' ? 'var(--primary-foreground)' : 'var(--muted-foreground)',
                  border: 'none',
                  cursor: 'pointer',
                  fontWeight: 600,
                  fontSize: '0.82rem',
                }}
              >
                🛡️ Rebuttal ({rebuttalCount})
              </button>
            )}

            <button
              onClick={() => setFilterMode('aff')}
              style={{
                padding: '0.4rem 0.85rem',
                borderRadius: '6px',
                background: filterMode === 'aff' ? 'var(--primary)' : 'var(--secondary)',
                color: filterMode === 'aff' ? 'var(--primary-foreground)' : 'var(--muted-foreground)',
                border: 'none',
                cursor: 'pointer',
                fontWeight: 600,
                fontSize: '0.82rem',
              }}
            >
              AFF
            </button>

            <button
              onClick={() => setFilterMode('neg')}
              style={{
                padding: '0.4rem 0.85rem',
                borderRadius: '6px',
                background: filterMode === 'neg' ? 'var(--primary)' : 'var(--secondary)',
                color: filterMode === 'neg' ? 'var(--primary-foreground)' : 'var(--muted-foreground)',
                border: 'none',
                cursor: 'pointer',
                fontWeight: 600,
                fontSize: '0.82rem',
              }}
            >
              NEG
            </button>
          </div>

          {/* Cards List */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            {filteredCards.map((card) => {
              const isContention = card.cardMode === 'contention';
              return (
                <div
                  key={card.id}
                  style={{
                    borderRadius: '12px',
                    border: '1px solid var(--border)',
                    overflow: 'hidden',
                  }}
                >
                  {/* Mode & Strategy Banner */}
                  <div
                    style={{
                      padding: '0.5rem 1rem',
                      background: 'var(--accent)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      borderBottom: '1px solid var(--card-border)',
                      flexWrap: 'wrap',
                      gap: '0.5rem',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span
                        style={{
                          fontSize: '0.72rem',
                          fontWeight: 700,
                          padding: '0.2rem 0.55rem',
                          borderRadius: '4px',
                          background: 'var(--primary)',
                          color: 'var(--primary-foreground)',
                          textTransform: 'uppercase',
                        }}
                      >
                        {isContention ? '📑 Contention Card' : '🛡️ Rebuttal Card'}
                      </span>
                      {card.strategyTarget && (
                        <span style={{ fontSize: '0.82rem', color: 'var(--foreground)', fontWeight: 600 }}>
                          {card.strategyTarget}
                        </span>
                      )}
                    </div>

                    <span style={{ fontSize: '0.75rem', color: 'var(--muted-foreground)' }}>
                      {isContention ? 'Use in Constructive Case' : 'Use in Rebuttal to Refute/Turn'}
                    </span>
                  </div>

                  {/* Standard Card Component */}
                  <Card card={card} />
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
