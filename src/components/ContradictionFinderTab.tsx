'use client';

import React, { useState } from 'react';
import { getAiConfigFromStorage } from '../lib/aiProvider';

interface ContradictionFlaw {
  flawType: string;
  quote1: string;
  quote2?: string;
  explanation: string;
  cxQuestion: string;
  speechRefutation: string;
}

export function ContradictionFinderTab() {
  const [topic, setTopic] = useState('');
  const [opponentText, setOpponentText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flaws, setFlaws] = useState<ContradictionFlaw[]>([]);
  const [summary, setSummary] = useState<string | null>(null);

  const handleAnalyze = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!opponentText.trim()) return;

    setLoading(true);
    setError(null);
    setFlaws([]);
    setSummary(null);

    const aiConfig = getAiConfigFromStorage();

    try {
      const response = await fetch('/api/contradictions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: topic.trim(),
          opponentText: opponentText.trim(),
          ...aiConfig,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to analyze text for contradictions');
      }

      setFlaws(data.flaws || []);
      setSummary(data.summary || null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'An error occurred during contradiction search');
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="card-box animate-fade-in" style={{ padding: 'clamp(1.2rem, 3.5vw, 2.2rem)' }}>
      <header style={{ marginBottom: '1.6rem' }}>
        <p style={{ margin: '0 0 0.35rem 0', fontFamily: 'var(--font-mono)', color: 'var(--muted-foreground)', fontSize: '0.72rem', fontWeight: 600, letterSpacing: '0.2em', textTransform: 'uppercase' }}>
          Flaw Finder · Contradiction Analysis
        </p>
        <h2 style={{ fontSize: '1.85rem', fontWeight: 600, fontStyle: 'italic', marginBottom: '0.45rem', letterSpacing: '-0.02em' }}>
          Contradictions & CX Traps
        </h2>
        <p style={{ color: 'var(--muted-foreground)', lineHeight: 1.55, margin: 0, fontSize: '0.92rem' }}>
          Paste your opponent&apos;s 1AC, 1NC, or article. The engine detects internal contradictions, self-defeating causal claims, and date gaps, outputting cross-examination questions and rebuttal blocks.
        </p>
      </header>

      <form onSubmit={handleAnalyze} style={{ display: 'flex', flexDirection: 'column', gap: '1.1rem', marginBottom: '1.5rem' }}>
        <div>
          <label style={{ display: 'block', fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--foreground)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.4rem' }}>
            Debate Topic / Context (Optional):
          </label>
          <input
            type="text"
            placeholder="e.g. Universal Basic Income, Sanctions policy…"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
          />
        </div>

        <div>
          <label style={{ display: 'block', fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--foreground)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.4rem' }}>
            Opponent Speech or Article Text:
          </label>
          <textarea
            rows={8}
            placeholder="Paste opponent's case, article text, or evidence block here…"
            value={opponentText}
            onChange={(e) => setOpponentText(e.target.value)}
            style={{ minHeight: '160px', lineHeight: 1.55 }}
          />
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button type="submit" disabled={loading || !opponentText.trim()} className="btn-primary">
            {loading ? 'Analyzing…' : 'Find Contradictions'}
          </button>
        </div>
      </form>

      {error && (
        <div style={{ padding: '0.75rem 1rem', background: 'var(--secondary)', border: '1px solid #b91c1c', color: '#b91c1c', borderRadius: 'var(--radius)', marginBottom: '1.5rem', fontSize: '0.84rem', fontFamily: 'var(--font-mono)' }}>
          {error}
        </div>
      )}

      {!loading && summary && flaws.length === 0 && !error && (
        <p aria-live="polite" style={{ color: 'var(--muted-foreground)', fontSize: '0.85rem', margin: '0 0 1rem' }}>
          Analysis completed without finding a source-supported strategic flaw.
        </p>
      )}

      {loading && (
        <div style={{ textAlign: 'center', padding: '2.5rem 1rem', color: 'var(--muted-foreground)' }}>
          <p style={{ margin: 0, fontFamily: 'var(--font-mono)', fontSize: '0.82rem' }}>
            Scanning opponent text for internal contradictions and logic gaps…
          </p>
        </div>
      )}

      {summary && (
        <div style={{ padding: '1.25rem', marginBottom: '1.5rem', background: 'var(--secondary)', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
          <h3 style={{ fontSize: '1rem', fontStyle: 'italic', marginBottom: '0.4rem' }}>
            Strategic Vulnerability Summary
          </h3>
          <p style={{ margin: 0, color: 'var(--foreground)', fontSize: '0.9rem', lineHeight: 1.55 }}>
            {summary}
          </p>
        </div>
      )}

      {flaws.length > 0 && (
        <div>
          <h3 style={{ fontSize: '1.25rem', fontStyle: 'italic', marginBottom: '1rem', borderBottom: '1px solid var(--border)', paddingBottom: '0.5rem' }}>
            Detected Flaws ({flaws.length})
          </h3>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            {flaws.map((flaw, idx) => (
              <div
                key={idx}
                style={{
                  padding: '1.25rem',
                  background: 'var(--card)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem' }}>
                  <span className="badge badge-neg">{flaw.flawType}</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--muted-foreground)' }}>
                    Flaw #{idx + 1}
                  </span>
                </div>

                <div style={{ marginBottom: '0.75rem' }}>
                  <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--muted-foreground)', margin: '0 0 0.25rem 0', fontWeight: 600 }}>
                    Opponent Statement 1:
                  </p>
                  <blockquote style={{ margin: 0, padding: '0.5rem 0.8rem', background: 'var(--secondary)', borderLeft: '3px solid var(--primary)', fontSize: '0.88rem', fontStyle: 'italic' }}>
                    &quot;{flaw.quote1}&quot;
                  </blockquote>
                </div>

                {flaw.quote2 && (
                  <div style={{ marginBottom: '0.75rem' }}>
                    <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--muted-foreground)', margin: '0 0 0.25rem 0', fontWeight: 600 }}>
                      Contradicting Statement 2:
                    </p>
                    <blockquote style={{ margin: 0, padding: '0.5rem 0.8rem', background: 'var(--secondary)', borderLeft: '3px solid #b91c1c', fontSize: '0.88rem', fontStyle: 'italic' }}>
                      &quot;{flaw.quote2}&quot;
                    </blockquote>
                  </div>
                )}

                <div style={{ marginBottom: '0.75rem' }}>
                  <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--muted-foreground)', margin: '0 0 0.2rem 0', fontWeight: 600 }}>
                    Explanation:
                  </p>
                  <p style={{ margin: 0, fontSize: '0.88rem', color: 'var(--foreground)', lineHeight: 1.5 }}>
                    {flaw.explanation}
                  </p>
                </div>

                <div style={{ background: 'var(--secondary)', padding: '0.75rem', borderRadius: 'var(--radius)', border: '1px solid var(--border)', marginBottom: '0.6rem' }}>
                  <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--primary)', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 0.2rem 0', fontWeight: 700 }}>
                    Cross-Examination Question:
                  </p>
                  <p style={{ margin: 0, fontSize: '0.9rem', fontStyle: 'italic', fontWeight: 600 }}>
                    &quot;{flaw.cxQuestion}&quot;
                  </p>
                </div>

                <div style={{ background: 'var(--secondary)', padding: '0.75rem', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
                  <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--primary)', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 0.2rem 0', fontWeight: 700 }}>
                    Rebuttal Speech Block:
                  </p>
                  <p style={{ margin: 0, fontSize: '0.88rem', color: 'var(--foreground)', lineHeight: 1.55 }}>
                    {flaw.speechRefutation}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
