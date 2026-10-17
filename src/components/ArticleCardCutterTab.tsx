'use client';

import React, { useRef, useState } from 'react';
import { Card, CardData } from './Card';
import { usePersistentState } from '../lib/usePersistentState';
import { getAiConfigFromStorage } from '../lib/aiProvider';

export function ArticleCardCutterTab() {
  const [url, setUrl] = usePersistentState('debate_cutter_url', '');
  const [focusClaim, setFocusClaim] = usePersistentState('debate_cutter_focus_claim', '');
  const [articleText, setArticleText] = usePersistentState('debate_cutter_article_text', '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cards, setCards] = useState<CardData[]>([]);
  const [status, setStatus] = useState('');
  const activeRequest = useRef<AbortController | null>(null);

  const handleCut = async (event: React.FormEvent) => {
    event.preventDefault();
    if (activeRequest.current) {
      activeRequest.current.abort();
      return;
    }
    setError(null);
    setCards([]);
    setLoading(true);
    setStatus('Starting automated card cutting…');
    const controller = new AbortController();
    activeRequest.current = controller;
    const excludedPassages: string[] = [];
    const seen = new Set<string>();
    let total = 0;
    let finalStatus = '';

    try {
      while (!controller.signal.aborted) {
        const aiConfig = getAiConfigFromStorage('navigator');
        const keyNumber = aiConfig.apiKeys?.length
          ? Math.min(Number(window.localStorage.getItem('debate_ai_api_key_cursor') || 1), aiConfig.apiKeys.length)
          : 0;
        setStatus(`Cut ${total} card${total === 1 ? '' : 's'} so far${aiConfig.providerMode === 'local' ? ' · local model' : aiConfig.apiKeys?.length ? ` · API key ${keyNumber} of ${aiConfig.apiKeys.length}` : ''}`);
        const response = await fetch('/api/cut-article', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            url: url.trim(),
            focusClaim: focusClaim.trim(),
            articleText: articleText.trim(),
            ...aiConfig,
            excludePassages: excludedPassages,
          }),
        });
        const data = await response.json();
        if (response.status === 429 || data.quotaExhausted) {
          if (aiConfig.apiKey) {
            continue;
          }
          finalStatus = aiConfig.providerMode === 'local'
            ? 'The local model could not complete this request.'
            : 'API key usage is exhausted.';
          break;
        }
        if (!response.ok) throw new Error(data.error || 'Could not cut cards from this article.');

        const freshCards: CardData[] = (Array.isArray(data.cards) ? data.cards : []).filter((card: CardData) => {
          const parsedBody = new DOMParser().parseFromString(card.bodyHtml, 'text/html');
          const highlightedPassages = Array.from(parsedBody.querySelectorAll('mark'))
            .map((mark) => mark.textContent?.replace(/\s+/g, ' ').trim() || '')
            .filter(Boolean);
          const fingerprint = highlightedPassages.join(' ').toLowerCase();
          if (!fingerprint || seen.has(fingerprint)) return false;
          seen.add(fingerprint);
          excludedPassages.push(...highlightedPassages);
          return true;
        });
        if (freshCards.length === 0) {
          finalStatus = total ? 'No new evidence passages remain in this article.' : 'No usable evidence was found. Try a different claim or article passage.';
          break;
        }
        total += freshCards.length;
        setCards((previous) => [...previous, ...freshCards]);
      }
      if (controller.signal.aborted) finalStatus = `Stopped. ${total} card${total === 1 ? '' : 's'} cut.`;
    } catch (cutError) {
      if (cutError instanceof Error && cutError.name === 'AbortError') {
        finalStatus = `Stopped. ${total} card${total === 1 ? '' : 's'} cut.`;
      } else {
        setError(cutError instanceof Error ? cutError.message : 'Could not cut cards from this article.');
      }
    } finally {
      activeRequest.current = null;
      setLoading(false);
      setStatus(finalStatus);
    }
  };

  return (
    <section className="glass animate-fade-in" style={{ maxWidth: 960, margin: '0 auto', padding: 'clamp(1.2rem, 4vw, 2.25rem)' }}>
      <header style={{ marginBottom: '1.6rem' }}>
        <p style={{ margin: '0 0 .45rem', color: 'var(--primary)', fontSize: '.75rem', fontWeight: 800, letterSpacing: '.14em', textTransform: 'uppercase' }}>
          Evidence cutter
        </p>
        <h2 style={{ color: 'var(--foreground)', fontSize: '1.65rem', marginBottom: '.55rem' }}>Cut cards from an article</h2>
        <p style={{ color: 'var(--muted-foreground)', lineHeight: 1.55, margin: 0 }}>
          The full article stays on every card. Highlight marks the concise warrant to read aloud; underline marks relevant supporting context.
        </p>
      </header>

      <form onSubmit={handleCut} style={{ display: 'grid', gap: '1rem' }}>
        <label style={{ display: 'grid', gap: '.45rem', color: 'var(--foreground)', fontSize: '.86rem', fontWeight: 650 }}>
          Article URL
          <input type="url" required placeholder="https://example.com/article" value={url} onChange={(event) => setUrl(event.target.value)} />
        </label>
        <label style={{ display: 'grid', gap: '.45rem', color: 'var(--foreground)', fontSize: '.86rem', fontWeight: 650 }}>
          What should the card find?
          <input type="text" required placeholder="e.g. evidence that renewable energy lowers electricity costs" value={focusClaim} onChange={(event) => setFocusClaim(event.target.value)} />
        </label>
        <label style={{ display: 'grid', gap: '.45rem', color: 'var(--foreground)', fontSize: '.86rem', fontWeight: 650 }}>
          Article text
          <textarea required rows={12} placeholder="Paste the article text here..." value={articleText} onChange={(event) => setArticleText(event.target.value)} style={{ minHeight: 240, lineHeight: 1.55 }} />
        </label>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button className={loading ? 'btn-secondary' : 'btn-primary'} type="submit" disabled={!loading && (!url.trim() || !focusClaim.trim() || !articleText.trim())}>
            {loading ? '■ Stop cutting' : '✂️ Start automated cutting'}
          </button>
        </div>
      </form>

      {error && <p role="alert" style={{ color: 'var(--destructive)', margin: '1rem 0 0' }}>{error}</p>}
      {(loading || status) && <p role="status" style={{ color: 'var(--muted-foreground)', margin: '1rem 0 0' }}>{status}</p>}
      {cards.length > 0 && (
        <div style={{ marginTop: '2rem' }}>
          <h3 style={{ color: 'var(--foreground)', marginBottom: '1rem' }}>Cut cards ({cards.length})</h3>
          {cards.map((card) => <Card key={card.id} card={card} />)}
        </div>
      )}
    </section>
  );
}
