'use client';

import React, { useRef, useState } from 'react';
import { Card, CardData } from './Card';
import { usePersistentState } from '../lib/usePersistentState';
import { DebateBlock, saveBlockToLibrary, downloadBlockDoc, formatCardPlain } from '../lib/cards';
import { getAiConfigFromStorage } from '../lib/aiProvider';

interface BloxTabProps {
  onSendToRheotriciser?: (card: CardData) => void;
  onSendToRanker?: (card: CardData) => void;
}

export function BloxTab({ onSendToRheotriciser, onSendToRanker }: BloxTabProps) {
  const [argument, setArgument] = usePersistentState('debate_blox_argument', '');
  const [mode, setMode] = useState<'web' | 'custom' | 'synthesis'>('web');
  const [customSources, setCustomSources] = useState<string[]>(['']);
  const [count, setCount] = useState<number | 'until-stopped'>(4);

  const [loading, setLoading] = useState(false);
  const activeRequest = useRef<AbortController | null>(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [block, setBlock] = useState<DebateBlock | null>(null);
  const [copiedBlock, setCopiedBlock] = useState(false);
  const [savedBlock, setSavedBlock] = useState(false);

  const examplePrompts = [
    'Cap K: Capitalism causes imperialism and ecological collapse',
    'Degrowth: Economic growth is incompatible with climate stabilization',
    'AUKUS triggers Chinese aggression and regional war',
    'Nuclear power is too slow and expensive to solve warming',
    'Sanctions on authoritarian regimes inevitably backfire',
  ];

  const handleAddCustomSource = () => {
    if (customSources.length < 5) {
      setCustomSources([...customSources, '']);
    }
  };

  const handleUpdateCustomSource = (idx: number, val: string) => {
    const next = [...customSources];
    next[idx] = val;
    setCustomSources(next);
  };

  const handleRemoveCustomSource = (idx: number) => {
    setCustomSources(customSources.filter((_, i) => i !== idx));
  };

  const handleBuild = async (e: React.FormEvent) => {
    e.preventDefault();
    if (activeRequest.current) {
      activeRequest.current.abort();
      setStatus('Stopping after the current request…');
      return;
    }
    if (!argument.trim()) return;

    setError(null);
    setBlock(null);
    setLoading(true);
    setStatus(
      mode === 'web'
        ? 'Searching web for empirical research and counter-evidence…'
        : mode === 'custom'
        ? 'Reading your custom sources and structuring evidence…'
        : 'Synthesizing strategic debate block…'
    );

    const controller = new AbortController();
    activeRequest.current = controller;

    try {
      let accumulatedBlock: DebateBlock | null = null;
      const seenCards = new Set<string>();
      const excludeCards: string[] = [];
      const excludeUrls: string[] = [];
      let cycle = 0;
      while (!controller.signal.aborted) {
        const aiConfig = getAiConfigFromStorage('planner');
        setStatus(
          count === 'until-stopped'
            ? `Building Blox · ${accumulatedBlock?.cards.length ?? 0} cards collected · round ${cycle + 1}…`
            : 'Building your debate block…'
        );
        const res = await fetch('/api/blox', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            argument: argument.trim(),
            mode,
            customSources: mode === 'custom' ? customSources.filter((s) => s.trim()) : undefined,
            count: count === 'until-stopped' ? 4 : count,
            cycle,
            excludeCards,
            excludeUrls,
            ...aiConfig,
          }),
        });

        const data = await res.json() as { block?: DebateBlock; error?: string };
        if (!res.ok || !data.block) {
          throw new Error(data.error || 'Failed to construct debate block.');
        }

        const freshCards = data.block.cards.filter((card) => {
          const fingerprint = `${card.tag.toLowerCase()}|${card.citation.toLowerCase()}|${card.bodyHtml.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().toLowerCase()}`;
          if (seenCards.has(fingerprint)) return false;
          seenCards.add(fingerprint);
          excludeCards.push(`${card.tag} — ${card.citation}`);
          if (card.sourceUrl && !excludeUrls.includes(card.sourceUrl)) {
            excludeUrls.push(card.sourceUrl);
          }
          return true;
        });

        const previousCards: DebateBlock['cards'] = accumulatedBlock ? accumulatedBlock.cards : [];
        accumulatedBlock = {
          ...(accumulatedBlock ?? data.block),
          cards: [...previousCards, ...freshCards],
        };
        setBlock(accumulatedBlock);
        cycle += 1;

        if (count !== 'until-stopped' || freshCards.length === 0) {
          if (count === 'until-stopped' && freshCards.length === 0) {
            setStatus('No new cards found in the latest round. Existing cards were kept.');
          } else {
            setStatus('');
          }
          break;
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        setStatus('Stopped. Cards already collected were kept.');
      } else {
        setError(err instanceof Error ? err.message : 'Error building block.');
        setStatus('');
      }
    } finally {
      activeRequest.current = null;
      setLoading(false);
    }
  };

  const handleCopyBlock = async () => {
    if (!block) return;
    const headerText = `${block.title.toUpperCase()}\nClaim: ${block.claim}\nWarrant: ${block.warrant}\nImpact: ${block.impact}\n\n`;
    const cardsText = block.cards.map((c) => formatCardPlain(c)).join('\n\n---\n\n');
    try {
      await navigator.clipboard.writeText(headerText + cardsText);
      setCopiedBlock(true);
      setTimeout(() => setCopiedBlock(false), 2000);
    } catch {
      // ignore
    }
  };

  const handleSaveBlock = () => {
    if (!block) return;
    saveBlockToLibrary(block);
    setSavedBlock(true);
    setTimeout(() => setSavedBlock(false), 2500);
  };

  const handleDownloadDoc = () => {
    if (!block) return;
    downloadBlockDoc(block);
  };

  return (
    <section className="card-box animate-fade-in" style={{ padding: 'clamp(1.2rem, 3.5vw, 2.2rem)' }}>
      <header style={{ marginBottom: '1.6rem' }}>
        <p style={{ margin: '0 0 0.35rem 0', fontFamily: 'var(--font-mono)', color: 'var(--muted-foreground)', fontSize: '0.72rem', fontWeight: 600, letterSpacing: '0.2em', textTransform: 'uppercase' }}>
          Blox Builder · Refutation Engine
        </p>
        <h2 style={{ fontSize: '1.85rem', fontWeight: 600, fontStyle: 'italic', marginBottom: '0.45rem', letterSpacing: '-0.02em' }}>
          Automated Refutation Blox
        </h2>
        <p style={{ color: 'var(--muted-foreground)', lineHeight: 1.55, margin: 0, fontSize: '0.92rem' }}>
          Provide any opponent argument or resolution claim. The engine synthesizes turns, uniqueness cards, impact calculus, and speech-ready frontlines using live web research or custom literature.
        </p>
      </header>

      {/* Mode Selector */}
      <div style={{ display: 'inline-flex', borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'var(--secondary)', padding: '2px', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={() => setMode('web')}
          style={{
            padding: '0.4rem 0.85rem',
            fontFamily: 'var(--font-mono)',
            fontSize: '0.74rem',
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            borderRadius: 'calc(var(--radius) - 2px)',
            border: 'none',
            cursor: 'pointer',
            background: mode === 'web' ? 'var(--primary)' : 'transparent',
            color: mode === 'web' ? 'var(--primary-foreground)' : 'var(--muted-foreground)',
          }}
        >
          Web Research
        </button>
        <button
          type="button"
          onClick={() => setMode('custom')}
          style={{
            padding: '0.4rem 0.85rem',
            fontFamily: 'var(--font-mono)',
            fontSize: '0.74rem',
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            borderRadius: 'calc(var(--radius) - 2px)',
            border: 'none',
            cursor: 'pointer',
            background: mode === 'custom' ? 'var(--primary)' : 'transparent',
            color: mode === 'custom' ? 'var(--primary-foreground)' : 'var(--muted-foreground)',
          }}
        >
          Custom Sources
        </button>
        <button
          type="button"
          onClick={() => setMode('synthesis')}
          style={{
            padding: '0.4rem 0.85rem',
            fontFamily: 'var(--font-mono)',
            fontSize: '0.74rem',
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            borderRadius: 'calc(var(--radius) - 2px)',
            border: 'none',
            cursor: 'pointer',
            background: mode === 'synthesis' ? 'var(--primary)' : 'transparent',
            color: mode === 'synthesis' ? 'var(--primary-foreground)' : 'var(--muted-foreground)',
          }}
        >
          Literature Synthesis
        </button>
      </div>

      <form onSubmit={handleBuild} style={{ display: 'grid', gap: '1.1rem' }}>
        <div>
          <label style={{ display: 'block', fontFamily: 'var(--font-mono)', fontSize: '0.72rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.4rem', color: 'var(--foreground)' }}>
            Opponent Argument to Refute / Block Title
          </label>
          <textarea
            required
            rows={3}
            placeholder="e.g. Capitalism causes war and imperialism (Cap K) OR Space commercialization militarizes orbit…"
            value={argument}
            onChange={(e) => setArgument(e.target.value)}
            style={{ fontSize: '0.95rem', lineHeight: 1.5 }}
          />

          {/* Prompt chips */}
          <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', marginTop: '0.6rem' }}>
            <span style={{ fontSize: '0.72rem', color: 'var(--muted-foreground)', alignSelf: 'center', fontFamily: 'var(--font-mono)' }}>Examples:</span>
            {examplePrompts.map((p, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => setArgument(p)}
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.68rem',
                  padding: '0.2rem 0.5rem',
                  borderRadius: 'var(--radius)',
                  background: 'var(--secondary)',
                  border: '1px solid var(--border)',
                  color: 'var(--muted-foreground)',
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                {p.slice(0, 36)}…
              </button>
            ))}
          </div>
        </div>

        {/* Custom Sources Mode inputs */}
        {mode === 'custom' && (
          <div style={{ background: 'var(--secondary)', padding: '1rem', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
            <label style={{ display: 'block', fontFamily: 'var(--font-mono)', fontSize: '0.72rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.5rem', color: 'var(--foreground)' }}>
              Custom Sources (URLs or Article Texts)
            </label>
            <div style={{ display: 'grid', gap: '0.6rem' }}>
              {customSources.map((src, i) => (
                <div key={i} style={{ display: 'flex', gap: '0.5rem' }}>
                  <input
                    type="text"
                    placeholder={`Source ${i + 1}: URL or pasted excerpt`}
                    value={src}
                    onChange={(e) => handleUpdateCustomSource(i, e.target.value)}
                    style={{ fontSize: '0.86rem' }}
                  />
                  {customSources.length > 1 && (
                    <button
                      type="button"
                      onClick={() => handleRemoveCustomSource(i)}
                      className="btn-secondary"
                      style={{ padding: '0.4rem 0.7rem' }}
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
            </div>
            {customSources.length < 5 && (
              <button
                type="button"
                onClick={handleAddCustomSource}
                className="btn-secondary"
                style={{ marginTop: '0.6rem', fontSize: '0.72rem', padding: '0.35rem 0.75rem' }}
              >
                + Add Another Source
              </button>
            )}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <label style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--muted-foreground)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Cards:
            </label>
            <select
              value={count}
              onChange={(e) => setCount(e.target.value === 'until-stopped' ? 'until-stopped' : Number(e.target.value))}
              style={{ width: 'auto', padding: '0.35rem 0.55rem', fontSize: '0.8rem' }}
            >
              <option value={3}>3 cards</option>
              <option value={4}>4 cards</option>
              <option value={5}>5 cards</option>
              <option value={6}>6 cards</option>
              <option value="until-stopped">Until I stop</option>
            </select>
          </div>

          <button
            type="submit"
            className={loading ? 'btn-secondary' : 'btn-primary'}
            disabled={!loading && !argument.trim()}
          >
            {loading ? 'Stop' : 'Build Blox'}
          </button>
        </div>
      </form>

      {error && (
        <div style={{ marginTop: '1.25rem', padding: '0.75rem 1rem', background: 'var(--secondary)', border: '1px solid #b91c1c', borderRadius: 'var(--radius)', color: '#b91c1c', fontSize: '0.84rem', fontFamily: 'var(--font-mono)' }}>
          <strong>Error: </strong> {error}
        </div>
      )}

      {(loading || status) && (
        <div style={{ marginTop: '1.25rem', color: 'var(--primary)', fontSize: '0.82rem', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
          {status}
        </div>
      )}

      {/* Completed Block Display */}
      {block && (
        <div style={{ marginTop: '2.5rem' }}>
          {/* Block Overview Panel */}
          <div
            style={{
              padding: '1.5rem',
              borderRadius: 'var(--radius)',
              background: 'var(--card)',
              border: '1px solid var(--border)',
              marginBottom: '1.75rem',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.8rem', marginBottom: '1rem' }}>
              <div>
                <span
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '0.68rem',
                    padding: '0.15rem 0.5rem',
                    borderRadius: 'var(--radius)',
                    background: 'var(--secondary)',
                    border: '1px solid var(--border)',
                    color: 'var(--primary)',
                    fontWeight: 700,
                    letterSpacing: '0.1em',
                    textTransform: 'uppercase',
                  }}
                >
                  Debate Block Strategy
                </span>
                <h3 style={{ fontSize: '1.5rem', fontStyle: 'italic', margin: '0.4rem 0 0.2rem' }}>
                  {block.title}
                </h3>
              </div>

              {/* Action Buttons */}
              <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={handleCopyBlock}
                  className="btn-secondary"
                  style={{ fontSize: '0.74rem', padding: '0.4rem 0.8rem' }}
                >
                  {copiedBlock ? 'Copied' : 'Copy Block'}
                </button>
                <button
                  type="button"
                  onClick={handleSaveBlock}
                  className="btn-secondary"
                  style={{ fontSize: '0.74rem', padding: '0.4rem 0.8rem', color: savedBlock ? '#16a34a' : undefined }}
                >
                  {savedBlock ? 'Saved' : 'Save'}
                </button>
                <button
                  type="button"
                  onClick={handleDownloadDoc}
                  className="btn-secondary"
                  style={{ fontSize: '0.74rem', padding: '0.4rem 0.8rem' }}
                >
                  Download .doc
                </button>
              </div>
            </div>

            <div style={{ display: 'grid', gap: '0.5rem', fontSize: '0.88rem', lineHeight: 1.55 }}>
              <div>
                <strong style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--primary)', display: 'inline-block', width: '110px' }}>
                  Core Claim:
                </strong>
                <span>{block.claim}</span>
              </div>
              <div>
                <strong style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--primary)', display: 'inline-block', width: '110px' }}>
                  Warrant:
                </strong>
                <span style={{ color: 'var(--muted-foreground)' }}>{block.warrant}</span>
              </div>
              <div>
                <strong style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--primary)', display: 'inline-block', width: '110px' }}>
                  Impact:
                </strong>
                <span style={{ color: 'var(--muted-foreground)' }}>{block.impact}</span>
              </div>
            </div>

            {block.frontlinePoints && block.frontlinePoints.length > 0 && (
              <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--border)' }}>
                <strong style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--foreground)', textTransform: 'uppercase', letterSpacing: '0.08em', display: 'block', marginBottom: '0.4rem' }}>
                  Frontline Speech Points:
                </strong>
                <ul style={{ margin: 0, paddingLeft: '1.2rem', color: 'var(--foreground)', fontSize: '0.86rem', lineHeight: 1.55 }}>
                  {block.frontlinePoints.map((pt, i) => (
                    <li key={i} style={{ marginBottom: '0.25rem' }}>{pt}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* Evidence Cards */}
          <div style={{ display: 'grid', gap: '1.25rem' }}>
            <h4 style={{ fontSize: '1.2rem', margin: 0, fontStyle: 'italic', borderBottom: '1px solid var(--border)', paddingBottom: '0.5rem' }}>
              Supporting Evidence Cards ({block.cards.length})
            </h4>
            {block.cards.map((c) => (
              <Card
                key={c.id}
                card={c}
                onSendToRheotriciser={onSendToRheotriciser}
                onSendToRanker={onSendToRanker}
              />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
