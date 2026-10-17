'use client';

import React, { useMemo, useState } from 'react';
import { CardData, CardQualityRating } from './Card';
import { usePersistentState } from '../lib/usePersistentState';
import { getAiConfigFromStorage } from '../lib/aiProvider';

interface CardRankerTabProps {
  cards: CardData[];
  topic: string;
  onCardsUpdate: (cards: CardData[]) => void;
}

function textFromHtml(html: string) {
  return html.replace(/<br\s*\/?>(\s*)/gi, '\n').replace(/<[^>]+>/g, '').trim();
}

function scoreColor(score?: number) {
  if (!score) return '#94a3b8';
  if (score >= 8) return '#34d399';
  if (score >= 5) return '#fbbf24';
  return '#fb7185';
}

export function CardRankerTab({ cards, topic, onCardsUpdate }: CardRankerTabProps) {
  const [selectedContention, setSelectedContention] = useState('all');
  const [pasteContention, setPasteContention] = usePersistentState('debate_ranker_contention', 'Pasted argument');
  const [pasteText, setPasteText] = usePersistentState('debate_ranker_paste_text', '');
  const [pastedCards, setPastedCards] = usePersistentState<CardData[]>('debate_ranker_pasted_cards', []);
  const [isRanking, setIsRanking] = useState(false);
  const [status, setStatus] = useState('');
  const [copied, setCopied] = useState(false);

  const documentCards = useMemo(() => {
    const existingIds = new Set(cards.map((card) => card.id));
    return [...cards, ...pastedCards.filter((card) => !existingIds.has(card.id))];
  }, [cards, pastedCards]);

  const groups = useMemo(() => {
    const grouped = new Map<string, CardData[]>();
    documentCards.forEach((card) => {
      const key = card.contention?.trim() || 'Unsorted argument';
      grouped.set(key, [...(grouped.get(key) ?? []), card]);
    });
    return [...grouped.entries()].map(([contention, groupCards]) => ({
      contention,
      cards: [...groupCards].sort((a, b) => (b.qualityRating?.score ?? 0) - (a.qualityRating?.score ?? 0)),
    }));
  }, [documentCards]);

  const visibleGroups = selectedContention === 'all'
    ? groups
    : groups.filter((group) => group.contention === selectedContention);
  const rankedCount = pastedCards.filter((card) => card.qualityRating).length;

  function addPastedCards() {
    const blocks = pasteText
      .split(/\n\s*\n+/)
      .map((block) => block.trim())
      .filter(Boolean);
    const parsed = blocks.map((block, index) => {
      const lines = block.split('\n').map((line) => line.trim()).filter(Boolean);
      const firstLine = lines.shift() || `Pasted card ${index + 1}`;
      const typeMatch = firstLine.match(/^\[?(AFF|NEG|NQ|NL|DL|T)\]?\s*[:-]?\s*/i);
      const type = typeMatch?.[1]?.toUpperCase() || 'AFF';
      const tag = firstLine.replace(/^\[?(AFF|NEG|NQ|NL|DL|T)\]?\s*[:-]?\s*/i, '').trim();
      const citation = lines.shift() || 'Pasted source';
      const body = lines.join('\n') || citation;
      return {
        id: `pasted_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 8)}`,
        contention: pasteContention.trim() || 'Pasted argument',
        tag,
        citation,
        bodyHtml: body.replace(/\n/g, '<br />'),
        type,
      } satisfies CardData;
    });
    if (parsed.length === 0) {
      setStatus('Paste one or more cards first. Separate cards with a blank line.');
      return;
    }
    setPastedCards((previous) => [...previous, ...parsed]);
    setPasteText('');
    setStatus(`Added ${parsed.length} pasted card${parsed.length === 1 ? '' : 's'}. Only these cards will be ranked.`);
  }

  async function rankCards() {
    if (pastedCards.length === 0 || isRanking) return;
    setIsRanking(true);
    const nextCards = [...pastedCards];
    const unranked = nextCards.filter((card) => !card.qualityRating);
    let completed = 0;

    for (const card of unranked) {
      setStatus(`Ranking card ${completed + 1} of ${unranked.length}…`);
      try {
        const response = await fetch('/api/ranking', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            topic,
            contention: card.contention,
            type: card.type,
            tag: card.tag,
            citation: card.citation,
            bodyHtml: card.bodyHtml,
            reasoning: card.reasoning,
            ...getAiConfigFromStorage(),
          }),
        });
        const payload = await response.json() as { rating?: CardQualityRating };
        if (response.ok && payload.rating) {
          const index = nextCards.findIndex((candidate) => candidate.id === card.id);
          if (index >= 0) nextCards[index] = { ...nextCards[index], qualityRating: payload.rating };
        }
      } catch {
        // Keep the card visible and continue ranking the rest of the document.
      }
      completed += 1;
      setPastedCards([...nextCards]);
      onCardsUpdate([...nextCards]);
    }
    setStatus(unranked.length ? `Finished ranking ${unranked.length} pasted card${unranked.length === 1 ? '' : 's'}. Existing cards were not ranked.` : 'The pasted cards are already ranked.');
    setIsRanking(false);
  }

  async function copyDocument() {
    const html = visibleGroups.map((group) => `
      <h2>${group.contention}</h2>
      ${group.cards.map((card) => `<h3>${card.tag || 'Untitled card'} — ${card.qualityRating?.score ?? '—'}/10</h3><p><i>${card.citation}</i></p><div>${card.bodyHtml}</div>`).join('')}
    `).join('');
    try {
      await navigator.clipboard.write([new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([visibleGroups.flatMap((group) => [group.contention, ...group.cards.map((card) => `${card.tag}\n${card.citation}\n${textFromHtml(card.bodyHtml)}`)]).join('\n\n')], { type: 'text/plain' }),
      })]);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setStatus('Copy failed — select the document text and copy it manually.');
    }
  }

  return (
    <section className="ranker-shell animate-fade-in">
      <aside className="ranker-outline glass-panel">
        <div className="ranker-outline-header">
          <span className="ranker-kicker">DOCUMENT OUTLINE</span>
          <strong>{groups.length} arguments</strong>
        </div>
        <button className={`ranker-outline-item ${selectedContention === 'all' ? 'selected' : ''}`} onClick={() => setSelectedContention('all')}>
          <span>▦</span><span>All arguments</span><small>{documentCards.length}</small>
        </button>
        {groups.map((group) => (
          <button key={group.contention} className={`ranker-outline-item ${selectedContention === group.contention ? 'selected' : ''}`} onClick={() => setSelectedContention(group.contention)}>
            <span className="outline-dot">●</span><span>{group.contention}</span><small>{group.cards.length}</small>
          </button>
        ))}
      </aside>

      <main className="ranker-document">
        <div className="ranker-toolbar">
          <div>
            <span className="ranker-kicker">CARD RANKER</span>
            <h1>{topic || 'Untitled debate'}</h1>
            <p>Every argument, organized like a living brief. Cards are ordered strongest to weakest.</p>
          </div>
          <div className="ranker-actions">
            <span className="ranker-progress">{rankedCount}/{pastedCards.length} pasted ranked</span>
            <button className="btn-secondary" onClick={copyDocument} disabled={documentCards.length === 0}>{copied ? '✓ Copied' : 'Copy doc'}</button>
            <button className="btn-primary" onClick={() => void rankCards()} disabled={isRanking || pastedCards.length === 0 || rankedCount === pastedCards.length}>
              {isRanking ? 'Ranking…' : rankedCount === pastedCards.length && pastedCards.length > 0 ? 'Pasted cards ranked' : 'Rank pasted cards'}
            </button>
          </div>
        </div>

        <div className="ranker-paste glass-panel">
          <div className="ranker-paste-heading"><div><span className="ranker-kicker">PASTE YOUR OWN CARDS</span><h2>Rank only what you paste</h2><p>Use one card per block: first line tag, second line citation, remaining lines evidence.</p></div><span className="ranker-paste-count">{pastedCards.length} pasted</span></div>
          <div className="ranker-paste-controls"><input value={pasteContention} onChange={(event) => setPasteContention(event.target.value)} placeholder="Argument heading" /><textarea value={pasteText} onChange={(event) => setPasteText(event.target.value)} placeholder={'Example:\nAFF: Cameras reduce theft\nSmith 2024, Urban Safety Lab\nThe study finds that…\n\nAFF: Community patrols deter crime\nJones 2023, DOJ\nResearchers report…'} rows={5} /><button className="btn-secondary" type="button" onClick={addPastedCards}>Add pasted cards</button></div>
        </div>

        {documentCards.length === 0 ? (
          <div className="ranker-empty"><div>✦</div><h2>Your document is empty</h2><p>Generate cards or paste your own cards above. The AI only ranks cards pasted into this tool.</p></div>
        ) : (
          <div className="ranker-paper">
            {visibleGroups.map((group, groupIndex) => (
              <section className="ranker-section" key={group.contention}>
                <div className="ranker-section-heading"><span>{String(groupIndex + 1).padStart(2, '0')}</span><h2>{group.contention}</h2><em>{group.cards.length} cards</em></div>
                {group.cards.map((card, index) => (
                  <article className="ranker-card" key={card.id}>
                    <div className="ranker-card-rank" style={{ color: scoreColor(card.qualityRating?.score) }}>{String(index + 1).padStart(2, '0')}</div>
                    <div className="ranker-card-body">
                      <div className="ranker-card-meta"><span className="ranker-type">{card.type}</span>{card.qualityRating && <span className="ranker-score" style={{ color: scoreColor(card.qualityRating.score) }}>{card.qualityRating.score}/10 · {card.qualityRating.label}</span>}</div>
                      <h3>{card.tag || 'Untitled card'}</h3>
                      <p className="ranker-citation">{card.citation}</p>
                      {card.qualityRating?.rationale && <p className="ranker-rationale">AI read: {card.qualityRating.rationale}</p>}
                      <div className="ranker-evidence" dangerouslySetInnerHTML={{ __html: card.bodyHtml }} />
                    </div>
                  </article>
                ))}
              </section>
            ))}
          </div>
        )}
        {status && <p className="ranker-status">{status}</p>}
      </main>
    </section>
  );
}
