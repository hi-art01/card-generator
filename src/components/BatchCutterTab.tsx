'use client';

import React, { useRef, useState } from 'react';
import { Card, CardData } from './Card';
import { copyCardsPlain, saveCardToLibrary, downloadDoc } from '../lib/cards';
import { getAiConfigFromStorage } from '../lib/aiProvider';

interface BatchSourceInput {
  id: string;
  value: string;
  status?: 'idle' | 'running' | 'done' | 'error';
  cardsCut?: number;
  error?: string;
}

interface GroupedSourceResult {
  sourceId: string;
  sourceTitle: string;
  sourceUrl?: string;
  cards: CardData[];
}

interface BatchCutterTabProps {
  onSendToRheotriciser?: (card: CardData) => void;
  onSendToRanker?: (card: CardData) => void;
}

export function BatchCutterTab({ onSendToRheotriciser, onSendToRanker }: BatchCutterTabProps) {
  const [sources, setSources] = useState<BatchSourceInput[]>([
    { id: '1', value: '' },
    { id: '2', value: '' },
    { id: '3', value: '' },
  ]);
  const [bulkInput, setBulkInput] = useState('');
  const [goal, setGoal] = useState('');
  const [cardType, setCardType] = useState('AFF');
  const [untilStopped, setUntilStopped] = useState(false);
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [generalError, setGeneralError] = useState('');
  const [results, setResults] = useState<GroupedSourceResult[]>([]);
  const [allSaved, setAllSaved] = useState(false);
  const activeRequest = useRef<AbortController | null>(null);

  const handleAddSource = () => {
    if (sources.length < 15) {
      setSources([...sources, { id: String(Date.now()), value: '' }]);
    }
  };

  const handleUpdateSource = (id: string, val: string) => {
    setSources(sources.map((s) => (s.id === id ? { ...s, value: val } : s)));
  };

  const handleRemoveSource = (id: string) => {
    if (sources.length > 1) {
      setSources(sources.filter((s) => s.id !== id));
    }
  };

  const handleParseBulk = () => {
    const lines = bulkInput
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    if (!lines.length) return;

    const newItems: BatchSourceInput[] = lines.map((l, i) => ({
      id: String(Date.now() + i),
      value: l,
    }));

    // Replace empty slots or append
    const existing = sources.filter((s) => s.value.trim());
    setSources([...existing, ...newItems].slice(0, 15));
    setBulkInput('');
  };

  const handleBatchCut = async (e: React.FormEvent) => {
    e.preventDefault();
    if (activeRequest.current) {
      activeRequest.current.abort();
      activeRequest.current = null;
      setLoading(false);
      setStatusMsg('Stopped by user. Cards already cut were kept.');
      return;
    }
    const validSources = sources.filter((s) => s.value.trim());
    if (!validSources.length) return;

    setGeneralError('');
    setResults([]);
    setLoading(true);
    setStatusMsg(`Cutting cards in parallel across ${validSources.length} sources…`);
    const controller = new AbortController();
    activeRequest.current = controller;

    setSources((prev) =>
      prev.map((s) => (s.value.trim() ? { ...s, status: 'running', error: undefined } : s))
    );

    const payloadSources = validSources.map((s) => {
      const isUrl = /^https?:\/\//i.test(s.value.trim());
      return {
        id: s.id,
        url: isUrl ? s.value.trim() : undefined,
        text: !isUrl ? s.value.trim() : undefined,
        title: isUrl ? undefined : s.value.slice(0, 40),
      };
    });

    try {
      const accumulated = new Map<string, GroupedSourceResult>();
      const seen = new Set<string>();
      const excludedPassages: Record<string, string[]> = {};
      let pass = 0;
      while (!controller.signal.aborted) {
        const aiConfig = getAiConfigFromStorage('navigator');
        setStatusMsg(untilStopped
          ? `Cutting batch round ${pass + 1}… ${Array.from(accumulated.values()).reduce((sum, result) => sum + result.cards.length, 0)} cards so far.`
          : `Cutting cards in parallel across ${validSources.length} sources…`);
        const res = await fetch('/api/batch-cut', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            sources: payloadSources,
            goal: goal.trim(),
            cardType,
            ...aiConfig,
            density: aiConfig.density || 'tech',
            apiKey: (aiConfig.apiKey ?? '').trim(),
            baseUrl: (aiConfig.baseUrl ?? '').trim(),
            model: (aiConfig.model ?? '').trim(),
            excludePassagesBySource: excludedPassages,
          }),
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Batch cutting failed.');
        const returnedResults: GroupedSourceResult[] = data.results || [];
        let newCardCount = 0;
        for (const result of returnedResults) {
          const current = accumulated.get(result.sourceId) ?? { ...result, cards: [] };
          for (const card of result.cards) {
            const fingerprint = `${card.tag}|${card.bodyHtml}`;
            if (seen.has(fingerprint)) continue;
            seen.add(fingerprint);
            current.cards.push(card);
            newCardCount += 1;
            const marked = Array.from(card.bodyHtml.matchAll(/<mark[^>]*>([\s\S]*?)<\/mark>/gi))
              .map((match) => match[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim())
              .filter(Boolean);
            excludedPassages[result.sourceId] = [
              ...(excludedPassages[result.sourceId] ?? []),
              ...marked,
            ];
          }
          if (current.cards.length) accumulated.set(result.sourceId, current);
        }
        pass += 1;
        const snapshots = Array.from(accumulated.values());
        setResults(snapshots);
        if (!untilStopped || newCardCount === 0) break;
      }

      const returnedResults = Array.from(accumulated.values());
      setSources((prev) =>
        prev.map((s) => {
          const result = returnedResults.find((item) => item.sourceId === s.id);
          return result
            ? { ...s, status: 'done', cardsCut: result.cards.length }
            : { ...s, status: 'done', cardsCut: 0 };
        })
      );
      const totalCut = returnedResults.reduce((acc, r) => acc + r.cards.length, 0);
      setStatusMsg(controller.signal.aborted
        ? `Stopped. Cut ${totalCut} cards across ${returnedResults.length} sources.`
        : `Done! Cut ${totalCut} cards across ${returnedResults.length} sources.`);
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        setStatusMsg('Stopped by user. Cards already cut were kept.');
      } else {
        setGeneralError(err instanceof Error ? err.message : 'Error during batch cut.');
      }
    } finally {
      activeRequest.current = null;
      setLoading(false);
    }
  };

  const allCards = results.flatMap((r) => r.cards);

  const handleCopyAll = async () => {
    if (!allCards.length) return;
    const ok = await copyCardsPlain(allCards);
    if (ok) {
      setStatusMsg(`Copied all ${allCards.length} cards to clipboard.`);
      setTimeout(() => setStatusMsg(''), 2500);
    }
  };

  const handleSaveAll = () => {
    if (!allCards.length) return;
    allCards.forEach((c) => saveCardToLibrary(c));
    setAllSaved(true);
    setTimeout(() => setAllSaved(false), 2500);
  };

  const handleDownloadAll = () => {
    if (!allCards.length) return;
    downloadDoc(allCards, 'batch-cards.doc', goal || 'Batch Debate Cards');
  };

  return (
    <section className="card-box animate-fade-in" style={{ padding: 'clamp(1.2rem, 3.5vw, 2.2rem)' }}>
      <header style={{ marginBottom: '1.6rem' }}>
        <p style={{ margin: '0 0 0.35rem 0', fontFamily: 'var(--font-mono)', color: 'var(--muted-foreground)', fontSize: '0.72rem', fontWeight: 600, letterSpacing: '0.2em', textTransform: 'uppercase' }}>
          Batch Card Cutter · Parallel Engine
        </p>
        <h2 style={{ fontSize: '1.85rem', fontWeight: 600, fontStyle: 'italic', marginBottom: '0.45rem', letterSpacing: '-0.02em' }}>
          Batch Evidence Cutter
        </h2>
        <p style={{ color: 'var(--muted-foreground)', lineHeight: 1.55, margin: 0, fontSize: '0.92rem' }}>
          Paste a list of links or multiple articles. The parallel cutter crawls each source concurrently, pulling tags, warrants, and context, grouped by publication.
        </p>
      </header>

      <form onSubmit={handleBatchCut} style={{ display: 'grid', gap: '1.1rem' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', color: 'var(--foreground)', fontSize: '0.86rem' }}>
          <input type="checkbox" checked={untilStopped} onChange={(event) => setUntilStopped(event.target.checked)} disabled={loading} />
          Keep cutting fresh evidence from these sources until stopped or no new passages remain
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem' }}>
          <div>
            <label style={{ display: 'block', fontFamily: 'var(--font-mono)', fontSize: '0.72rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.4rem', color: 'var(--foreground)' }}>
              Target Argument / Claim (Optional)
            </label>
            <input
              type="text"
              placeholder="e.g. Space exploration generates clean technology spin-offs"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontFamily: 'var(--font-mono)', fontSize: '0.72rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.4rem', color: 'var(--foreground)' }}>
              Card Tag Type
            </label>
            <select value={cardType} onChange={(e) => setCardType(e.target.value)}>
              <option value="AFF">AFF (Affirmative)</option>
              <option value="NEG">NEG (Negative)</option>
              <option value="NQ">NQ (Non-Unique)</option>
              <option value="NL">NL (No Link)</option>
              <option value="DL">DL (Link Turn)</option>
              <option value="T">T (Topicality)</option>
            </select>
          </div>
        </div>

        {/* Source List */}
        <div style={{ background: 'var(--secondary)', padding: '1.1rem', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
            <label style={{ fontFamily: 'var(--font-mono)', fontSize: '0.74rem', color: 'var(--foreground)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Sources ({sources.filter((s) => s.value.trim()).length} added)
            </label>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--muted-foreground)' }}>
              Accepts URLs or text
            </span>
          </div>

          <div style={{ display: 'grid', gap: '0.5rem' }}>
            {sources.map((s, idx) => (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--muted-foreground)', width: '20px' }}>
                  {idx + 1}.
                </span>
                <input
                  type="text"
                  placeholder="https://example.com/article OR paste text…"
                  value={s.value}
                  onChange={(e) => handleUpdateSource(s.id, e.target.value)}
                  style={{ fontSize: '0.86rem' }}
                />

                {/* Status indicator */}
                {s.status === 'running' && (
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--primary)' }}>
                    …
                  </span>
                )}
                {s.status === 'done' && (
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: '#16a34a', fontWeight: 600 }}>
                    ✓ ({s.cardsCut})
                  </span>
                )}
                {s.status === 'error' && (
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: '#b91c1c' }}>
                    ✕
                  </span>
                )}

                {sources.length > 1 && (
                  <button
                    type="button"
                    onClick={() => handleRemoveSource(s.id)}
                    className="btn-secondary"
                    style={{ padding: '0.35rem 0.6rem', fontSize: '0.72rem' }}
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', gap: '0.6rem', marginTop: '0.75rem' }}>
            <button
              type="button"
              onClick={handleAddSource}
              className="btn-secondary"
              style={{ fontSize: '0.72rem', padding: '0.35rem 0.75rem' }}
            >
              + Add Source
            </button>
          </div>

          {/* Bulk Paste Drawer */}
          <div style={{ marginTop: '0.85rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border)' }}>
            <label style={{ display: 'block', fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--muted-foreground)', fontWeight: 600, marginBottom: '0.35rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Bulk Paste URLs (one per line):
            </label>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <textarea
                rows={2}
                placeholder="https://site1.com&#10;https://site2.com"
                value={bulkInput}
                onChange={(e) => setBulkInput(e.target.value)}
                style={{ fontSize: '0.82rem', lineHeight: 1.4 }}
              />
              <button
                type="button"
                onClick={handleParseBulk}
                className="btn-secondary"
                style={{ alignSelf: 'flex-end', fontSize: '0.72rem', padding: '0.45rem 0.8rem', whiteSpace: 'nowrap' }}
              >
                + Add Links
              </button>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
          <button
            type="submit"
            className={loading ? 'btn-secondary' : 'btn-primary'}
            disabled={!loading && !sources.some((s) => s.value.trim())}
          >
            {loading ? 'Stop cutting' : 'Batch Cut All'}
          </button>
        </div>
      </form>

      {generalError && (
        <div style={{ marginTop: '1.25rem', padding: '0.75rem 1rem', background: 'var(--secondary)', border: '1px solid #b91c1c', borderRadius: 'var(--radius)', color: '#b91c1c', fontSize: '0.84rem', fontFamily: 'var(--font-mono)' }}>
          <strong>Error: </strong> {generalError}
        </div>
      )}

      {(loading || statusMsg) && (
        <div style={{ marginTop: '1.25rem', color: 'var(--primary)', fontSize: '0.82rem', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
          {statusMsg}
        </div>
      )}

      {/* Results grouped by source */}
      {results.length > 0 && (
        <div style={{ marginTop: '2.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '0.8rem', borderBottom: '1px solid var(--border)', paddingBottom: '0.75rem' }}>
            <h3 style={{ fontSize: '1.35rem', margin: 0, fontStyle: 'italic' }}>
              {allCards.length} Cards Across {results.length} Sources
            </h3>
            <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={handleCopyAll}
                className="btn-secondary"
                style={{ fontSize: '0.74rem', padding: '0.4rem 0.8rem' }}
              >
                Copy All Cards
              </button>
              <button
                type="button"
                onClick={handleSaveAll}
                className="btn-secondary"
                style={{ fontSize: '0.74rem', padding: '0.4rem 0.8rem', color: allSaved ? '#16a34a' : undefined }}
              >
                {allSaved ? 'Saved All!' : 'Save All'}
              </button>
              <button
                type="button"
                onClick={handleDownloadAll}
                className="btn-secondary"
                style={{ fontSize: '0.74rem', padding: '0.4rem 0.8rem' }}
              >
                Download .doc
              </button>
            </div>
          </div>

          <div style={{ display: 'grid', gap: '2rem' }}>
            {results.map((group) => (
              <div
                key={group.sourceId}
                style={{
                  background: 'var(--card)',
                  padding: '1.25rem',
                  borderRadius: 'var(--radius)',
                  border: '1px solid var(--border)',
                }}
              >
                <div style={{ marginBottom: '1rem', borderBottom: '1px solid var(--border)', paddingBottom: '0.6rem' }}>
                  <h4 style={{ fontSize: '1.15rem', fontStyle: 'italic', margin: '0 0 0.2rem' }}>
                    {group.sourceTitle}
                  </h4>
                  {group.sourceUrl && (
                    <a
                      href={group.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      style={{ color: 'var(--muted-foreground)', fontSize: '0.78rem', textDecoration: 'underline', wordBreak: 'break-all' }}
                    >
                      {group.sourceUrl}
                    </a>
                  )}
                </div>

                <div style={{ display: 'grid', gap: '1rem' }}>
                  {group.cards.map((c) => (
                    <Card
                      key={c.id}
                      card={c}
                      onSendToRheotriciser={onSendToRheotriciser}
                      onSendToRanker={onSendToRanker}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
