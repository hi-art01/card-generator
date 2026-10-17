'use client';

import React, { useState, useRef } from 'react';
import { Card, CardData } from './Card';
import { copyCardsPlain, downloadDoc } from '../lib/cards';
import { getAiConfigFromStorage } from '../lib/aiProvider';

interface AutoCarderTabProps {
  onSendToRheotriciser?: (card: CardData) => void;
  onSendToRanker?: (card: CardData) => void;
}

export function AutoCarderTab({ onSendToRheotriciser, onSendToRanker }: AutoCarderTabProps) {
  const [inputMode, setInputMode] = useState<'url' | 'text'>('url');
  const [url, setUrl] = useState('');
  const [text, setText] = useState('');
  const [focusClaim, setFocusClaim] = useState('');
  const [cutMode, setCutMode] = useState<'single' | 'multi' | 'until-stopped'>('single');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [cards, setCards] = useState<CardData[]>([]);

  const activeController = useRef<AbortController | null>(null);

  const handleCut = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) {
      if (activeController.current) {
        activeController.current.abort();
        activeController.current = null;
      }
      setLoading(false);
      setStatus('Stopped by user.');
      return;
    }

    setError('');
    setStatus(inputMode === 'url' ? 'Fetching article and analyzing arguments…' : 'Analyzing text and cutting card…');
    setLoading(true);

    const controller = new AbortController();
    activeController.current = controller;

    try {
      const seen = new Set<string>();
      let totalCut = 0;
      const maxPasses = cutMode === 'until-stopped' ? Number.POSITIVE_INFINITY : cutMode === 'multi' ? 4 : 1;
      const excludedPassages: string[] = [];

      for (let pass = 0; pass < maxPasses; pass++) {
        if (controller.signal.aborted) break;
        if (pass > 0) {
          setStatus(`Finding additional cards from article (${totalCut} cut so far)…`);
        }

        let res: Response;
        let data: { error?: string; cards?: CardData[]; card?: CardData };
        while (true) {
          const aiConfig = getAiConfigFromStorage('navigator');
          res = await fetch('/api/cut-article', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal,
            body: JSON.stringify({
              url: inputMode === 'url' ? url.trim() : undefined,
              articleText: inputMode === 'text' ? text.trim() : undefined,
              focusClaim: focusClaim.trim(),
              cardType: 'AUTO',
              ...aiConfig,
              density: aiConfig.density || 'tech',
              baseUrl: (aiConfig.baseUrl ?? '').trim(),
              model: (aiConfig.model ?? '').trim(),
              excludePassages: excludedPassages,
            }),
          });
          data = await res.json();
          if (res.status === 429 && aiConfig.apiKey) continue;
          if (!res.ok) throw new Error(data.error || 'Failed to cut card from article');
          break;
        }

        const freshCards: CardData[] = (Array.isArray(data.cards) ? data.cards : data.card ? [data.card] : []).filter(
          (c: CardData) => {
            const fingerprint = c.tag.toLowerCase();
            if (seen.has(fingerprint)) return false;
            seen.add(fingerprint);
            return true;
          }
        );

        if (!freshCards.length) break;

        totalCut += freshCards.length;
        setCards((prev) => [...prev, ...freshCards]);

        if (cutMode === 'single') break;
      }

      setStatus(`Done! ${totalCut} card${totalCut === 1 ? '' : 's'} cut.`);
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        setStatus(`Cutting stopped by user.`);
      } else {
        setError(err instanceof Error ? err.message : 'Error cutting card.');
      }
    } finally {
      activeController.current = null;
      setLoading(false);
    }
  };

  const handleCopyAll = async () => {
    if (!cards.length) return;
    await copyCardsPlain(cards);
    setStatus(`Copied all ${cards.length} cards to clipboard.`);
    setTimeout(() => setStatus(''), 2500);
  };

  const handleDownloadAll = () => {
    if (!cards.length) return;
    downloadDoc(cards, 'cut-cards.doc', focusClaim || 'Debate Evidence Cards');
  };

  return (
    <section className="card-box animate-fade-in" style={{ padding: 'clamp(1.2rem, 3.5vw, 2.2rem)' }}>
      <header style={{ marginBottom: '1.6rem' }}>
        <p style={{ margin: '0 0 0.35rem 0', fontFamily: 'var(--font-mono)', color: 'var(--muted-foreground)', fontSize: '0.72rem', fontWeight: 600, letterSpacing: '0.2em', textTransform: 'uppercase' }}>
          Auto Carder · DebateCard.ai
        </p>
        <h2 style={{ fontSize: '1.85rem', fontWeight: 600, fontStyle: 'italic', marginBottom: '0.45rem', letterSpacing: '-0.02em' }}>
          Instant Debate Card Cutter
        </h2>
        <p style={{ color: 'var(--muted-foreground)', lineHeight: 1.55, margin: 0, fontSize: '0.92rem' }}>
          Drop in an article link or paste raw text. The AI extracts claims, warrants, and context, producing bold tags, standard citations, and highlighted read-aloud evidence ready for Word and Verbatim.
        </p>
      </header>

      {/* Input Mode Selector */}
      <div style={{ display: 'inline-flex', borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'var(--secondary)', padding: '2px', marginBottom: '1.25rem' }}>
        <button
          type="button"
          onClick={() => setInputMode('url')}
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
            background: inputMode === 'url' ? 'var(--primary)' : 'transparent',
            color: inputMode === 'url' ? 'var(--primary-foreground)' : 'var(--muted-foreground)',
          }}
        >
          Article URL
        </button>
        <button
          type="button"
          onClick={() => setInputMode('text')}
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
            background: inputMode === 'text' ? 'var(--primary)' : 'transparent',
            color: inputMode === 'text' ? 'var(--primary-foreground)' : 'var(--muted-foreground)',
          }}
        >
          Paste Text
        </button>
      </div>

      <form onSubmit={handleCut} style={{ display: 'grid', gap: '1.1rem' }}>
        {inputMode === 'url' ? (
          <div>
            <label style={{ display: 'block', fontFamily: 'var(--font-mono)', fontSize: '0.72rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.4rem', color: 'var(--foreground)' }}>
              Article URL
            </label>
            <input
              type="url"
              required
              placeholder="https://www.nytimes.com/... or https://foreignaffairs.com/..."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
            <p style={{ margin: '0.35rem 0 0', fontSize: '0.75rem', color: 'var(--muted-foreground)' }}>
              We will automatically fetch and scrape the full text of the article.
            </p>
          </div>
        ) : (
          <div>
            <label style={{ display: 'block', fontFamily: 'var(--font-mono)', fontSize: '0.72rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.4rem', color: 'var(--foreground)' }}>
              Article Text
            </label>
            <textarea
              required
              rows={9}
              placeholder="Paste the full article or report text here..."
              value={text}
              onChange={(e) => setText(e.target.value)}
              style={{ minHeight: 180, lineHeight: 1.55 }}
            />
          </div>
        )}

        {/* Focus claim & Card controls */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem' }}>
          <div>
            <label style={{ display: 'block', fontFamily: 'var(--font-mono)', fontSize: '0.72rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.4rem', color: 'var(--foreground)' }}>
              Focus Claim (Optional)
            </label>
            <input
              type="text"
              placeholder="e.g. Clean energy investment stabilizes the electric grid"
              value={focusClaim}
              onChange={(e) => setFocusClaim(e.target.value)}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontFamily: 'var(--font-mono)', fontSize: '0.72rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.4rem', color: 'var(--foreground)' }}>
              Cutting Depth
            </label>
            <select
              value={cutMode}
              onChange={(e) => setCutMode(e.target.value as 'single' | 'multi' | 'until-stopped')}
            >
              <option value="single">Single Strongest Card</option>
              <option value="multi">Extract All Usable Cards</option>
              <option value="until-stopped">Cut Until Stopped</option>
            </select>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.5rem' }}>
          <button
            type="submit"
            className={loading ? 'btn-secondary' : 'btn-primary'}
            disabled={!loading && (inputMode === 'url' ? !url.trim() : !text.trim())}
          >
            {loading ? 'Stop' : 'Cut Card'}
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

      {/* Cards Results */}
      {cards.length > 0 && (
        <div style={{ marginTop: '2.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.2rem', flexWrap: 'wrap', gap: '0.75rem', borderBottom: '1px solid var(--border)', paddingBottom: '0.75rem' }}>
            <h3 style={{ fontSize: '1.35rem', margin: 0, fontStyle: 'italic' }}>
              {cards.length} Card{cards.length > 1 ? 's' : ''} Cut
            </h3>
            <div style={{ display: 'flex', gap: '0.45rem' }}>
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
                onClick={handleDownloadAll}
                className="btn-secondary"
                style={{ fontSize: '0.74rem', padding: '0.4rem 0.8rem' }}
              >
                Download .doc
              </button>
            </div>
          </div>

          <div style={{ display: 'grid', gap: '1.25rem' }}>
            {cards.map((card) => (
              <Card
                key={card.id}
                card={card}
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
