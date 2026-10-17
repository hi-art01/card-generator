'use client';

import React, { useState } from 'react';
import { Card, CardData } from './Card';
import { getAiConfigFromStorage } from '../lib/aiProvider';

interface CounterCardData extends CardData {
  strategyType?: string;
  source?: string;
}

interface CounterContentionBlock {
  contentionTitle: string;
  strategy: string;
  cards: CounterCardData[];
}

export function OpponentCaseCounterTab() {
  const [topic, setTopic] = useState('');
  const [opponentCase, setOpponentCase] = useState('');
  const [userDeposit, setUserDeposit] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [counterBlocks, setCounterBlocks] = useState<CounterContentionBlock[]>([]);
  const [opponentCaseSummary, setOpponentCaseSummary] = useState<string | null>(null);

  const handleGenerateCounter = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!opponentCase.trim()) return;

    setLoading(true);
    setError(null);
    setCounterBlocks([]);
    setOpponentCaseSummary(null);

    const aiConfig = getAiConfigFromStorage();

    try {
      const response = await fetch('/api/opponent-counter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: topic.trim(),
          opponentCase: opponentCase.trim(),
          userDeposit: userDeposit.trim(),
          ...aiConfig,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to generate opponent counter cards');
      }

      setCounterBlocks(data.counterBlocks || []);
      setOpponentCaseSummary(data.summary || null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'An error occurred while generating counter-case');
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="card-box animate-fade-in" style={{ padding: 'clamp(1.2rem, 3.5vw, 2.2rem)' }}>
      <header style={{ marginBottom: '1.6rem' }}>
        <p style={{ margin: '0 0 0.35rem 0', fontFamily: 'var(--font-mono)', color: 'var(--muted-foreground)', fontSize: '0.72rem', fontWeight: 600, letterSpacing: '0.2em', textTransform: 'uppercase' }}>
          Case Counter · Strategic Rebuttals
        </p>
        <h2 style={{ fontSize: '1.85rem', fontWeight: 600, fontStyle: 'italic', marginBottom: '0.45rem', letterSpacing: '-0.02em' }}>
          Opponent Case Counter
        </h2>
        <p style={{ color: 'var(--muted-foreground)', lineHeight: 1.55, margin: 0, fontSize: '0.92rem' }}>
          Deconstruct opponent speeches into individual contentions. Automatically match answers from depositories and your personal card vault.
        </p>
      </header>

      <form onSubmit={handleGenerateCounter} style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem', marginBottom: '1.5rem' }}>
        <div>
          <label style={{ display: 'block', fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--foreground)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.4rem' }}>
            Debate Topic (Optional):
          </label>
          <input
            type="text"
            placeholder="e.g. NATO Expansion, Single-Payer Healthcare…"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem' }}>
          <div>
            <label style={{ display: 'block', fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--foreground)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.4rem' }}>
              Opponent Case / Speech Text:
            </label>
            <textarea
              rows={8}
              placeholder="Paste opponent's full 1AC, 1NC, or contention text here…"
              value={opponentCase}
              onChange={(e) => setOpponentCase(e.target.value)}
              style={{ minHeight: '160px', lineHeight: 1.55 }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--foreground)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.4rem' }}>
              Your Card Deposit / Vault (Optional):
            </label>
            <textarea
              rows={8}
              placeholder="Paste your own block files or team card deposit here…"
              value={userDeposit}
              onChange={(e) => setUserDeposit(e.target.value)}
              style={{ minHeight: '160px', lineHeight: 1.55 }}
            />
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button type="submit" disabled={loading || !opponentCase.trim()} className="btn-primary">
            {loading ? 'Matching Counter Cards…' : 'Generate Counter-Case'}
          </button>
        </div>
      </form>

      {error && (
        <div style={{ padding: '0.75rem 1rem', background: 'var(--secondary)', border: '1px solid #b91c1c', color: '#b91c1c', borderRadius: 'var(--radius)', marginBottom: '1.5rem', fontSize: '0.84rem', fontFamily: 'var(--font-mono)' }}>
          {error}
        </div>
      )}

      {!loading && opponentCaseSummary && counterBlocks.length === 0 && !error && (
        <p aria-live="polite" style={{ color: 'var(--muted-foreground)', fontSize: '0.85rem', margin: '0 0 1rem' }}>
          The case was read, but no source-supported counter blocks were produced. Add clearer contention text or a card deposit and try again.
        </p>
      )}

      {loading && (
        <div style={{ textAlign: 'center', padding: '2.5rem 1rem', color: 'var(--muted-foreground)' }}>
          <p style={{ margin: 0, fontFamily: 'var(--font-mono)', fontSize: '0.82rem' }}>
            Parsing opponent case contentions and fetching matching counter cards…
          </p>
        </div>
      )}

      {opponentCaseSummary && (
        <div style={{ padding: '1.25rem', marginBottom: '1.5rem', background: 'var(--secondary)', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
          <h3 style={{ fontSize: '1rem', fontStyle: 'italic', marginBottom: '0.4rem' }}>
            Opponent Case Decomposition
          </h3>
          <p style={{ margin: 0, color: 'var(--foreground)', fontSize: '0.9rem', lineHeight: 1.55 }}>
            {opponentCaseSummary}
          </p>
        </div>
      )}

      {counterBlocks.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
          {counterBlocks.map((block, bIdx) => (
            <div key={bIdx} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '1.5rem' }}>
              <div style={{ marginBottom: '1rem', borderBottom: '1px solid var(--border)', paddingBottom: '0.75rem' }}>
                <h3 style={{ fontSize: '1.25rem', fontStyle: 'italic', marginBottom: '0.35rem' }}>
                  Target #{bIdx + 1}: {block.contentionTitle}
                </h3>
                <p style={{ color: 'var(--muted-foreground)', fontSize: '0.88rem', margin: 0, lineHeight: 1.5 }}>
                  <strong style={{ color: 'var(--foreground)' }}>Rebuttal: </strong> {block.strategy}
                </p>
              </div>

              {block.cards.length === 0 ? (
                <p style={{ color: 'var(--muted-foreground)', fontSize: '0.85rem', fontStyle: 'italic' }}>
                  No direct counter cards found for this specific contention link.
                </p>
              ) : (
                <div>
                  <h4 style={{ fontSize: '1rem', fontStyle: 'italic', marginBottom: '0.75rem' }}>
                    Counter Cards ({block.cards.length}):
                  </h4>
                  {block.cards.map((card) => (
                    <div key={card.id} style={{ marginBottom: '1rem' }}>
                      {card.strategyType && (
                        <div style={{ marginBottom: '0.4rem', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                          <span className="badge badge-nl">{card.strategyType}</span>
                          {card.source && (
                            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--muted-foreground)' }}>
                              Source: {card.source}
                            </span>
                          )}
                        </div>
                      )}
                      <Card card={card} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
