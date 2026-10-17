'use client';

import React, { useState } from 'react';
import { Card, CardData } from './Card';
import { getAiConfigFromStorage } from '../lib/aiProvider';

type DepositSource = 'all' | 'opencaselist' | 'debatify' | 'logos';
type Side = 'all' | 'aff' | 'neg';

export function CardDepositoriesTab() {
  const [query, setQuery] = useState('');
  const [depositSource, setDepositSource] = useState<DepositSource>('all');
  const [side, setSide] = useState<Side>('all');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cards, setCards] = useState<CardData[]>([]);
  const [searchSummary, setSearchSummary] = useState<string | null>(null);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;

    setLoading(true);
    setError(null);
    setCards([]);
    setSearchSummary(null);

    const aiConfig = getAiConfigFromStorage('navigator');

    try {
      const response = await fetch('/api/depositories/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: query.trim(),
          source: depositSource,
          side: side,
          ...aiConfig,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to search depositories');
      }

      setCards(data.cards || []);
      setSearchSummary(data.summary || `Found ${data.cards?.length || 0} cards.`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'An error occurred during depository search');
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="card-box animate-fade-in" style={{ padding: 'clamp(1.2rem, 3.5vw, 2.2rem)' }}>
      <header style={{ marginBottom: '1.6rem' }}>
        <p style={{ margin: '0 0 0.35rem 0', fontFamily: 'var(--font-mono)', color: 'var(--muted-foreground)', fontSize: '0.72rem', fontWeight: 600, letterSpacing: '0.2em', textTransform: 'uppercase' }}>
          Card Depositories · Evidence Search
        </p>
        <h2 style={{ fontSize: '1.85rem', fontWeight: 600, fontStyle: 'italic', marginBottom: '0.45rem', letterSpacing: '-0.02em' }}>
          Open Case List & Depositories
        </h2>
        <p style={{ color: 'var(--muted-foreground)', lineHeight: 1.55, margin: 0, fontSize: '0.92rem' }}>
          Search indexed debate evidence across Disclose Open Case List (OpenEv), Debatify, and Logos.
        </p>
      </header>

      <form onSubmit={handleSearch} style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', gap: '0.65rem', flexWrap: 'wrap' }}>
          <input
            type="text"
            placeholder="Enter debate topic, argument claim, or key terms (e.g., 'climate change economic growth')…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ flex: 1, minWidth: '280px' }}
          />
          <button type="submit" disabled={loading || !query.trim()} className="btn-primary">
            {loading ? 'Searching…' : 'Search Depositories'}
          </button>
        </div>

        <div style={{ display: 'flex', gap: '1.25rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <label style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--muted-foreground)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Deposit:
            </label>
            <select
              value={depositSource}
              onChange={(e) => setDepositSource(e.target.value as DepositSource)}
              style={{ width: 'auto', padding: '0.35rem 0.65rem', fontSize: '0.8rem' }}
            >
              <option value="all">All Depositories (Open Case List, Debatify, Logos)</option>
              <option value="opencaselist">Disclose Open Case List (OpenEv)</option>
              <option value="debatify">Debatify</option>
              <option value="logos">Logos</option>
            </select>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <label style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--muted-foreground)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Side:
            </label>
            <select
              value={side}
              onChange={(e) => setSide(e.target.value as Side)}
              style={{ width: 'auto', padding: '0.35rem 0.65rem', fontSize: '0.8rem' }}
            >
              <option value="all">All Sides (Aff & Neg)</option>
              <option value="aff">Affirmative Only</option>
              <option value="neg">Negative Only</option>
            </select>
          </div>
        </div>
      </form>

      {error && (
        <div style={{ padding: '0.75rem 1rem', background: 'var(--secondary)', border: '1px solid #b91c1c', color: '#b91c1c', borderRadius: 'var(--radius)', marginBottom: '1.5rem', fontSize: '0.84rem', fontFamily: 'var(--font-mono)' }}>
          {error}
        </div>
      )}

      {searchSummary && !error && (
        <p aria-live="polite" style={{ color: 'var(--primary)', fontSize: '0.82rem', fontFamily: 'var(--font-mono)', margin: '0 0 1rem', fontWeight: 600 }}>
          {searchSummary}
        </p>
      )}

      {loading && (
        <div style={{ textAlign: 'center', padding: '3rem 1rem', color: 'var(--muted-foreground)' }}>
          <p style={{ margin: 0, fontFamily: 'var(--font-mono)', fontSize: '0.82rem' }}>
            Searching live debate depositories and formatting cards…
          </p>
        </div>
      )}

      {!loading && cards.length > 0 && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', borderBottom: '1px solid var(--border)', paddingBottom: '0.5rem' }}>
            <h3 style={{ fontSize: '1.25rem', fontStyle: 'italic', margin: 0 }}>
              Found Cards ({cards.length})
            </h3>
          </div>
          <div style={{ display: 'grid', gap: '1.25rem' }}>
            {cards.map((card) => (
              <Card key={card.id} card={card} />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
