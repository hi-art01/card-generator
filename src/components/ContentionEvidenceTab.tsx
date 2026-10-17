'use client';

import React, { useRef, useState } from 'react';
import { Card, CardData } from './Card';
import { usePersistentState } from '../lib/usePersistentState';
import { getAiConfigFromStorage } from '../lib/aiProvider';

interface ContentionEvidenceTabProps {
  topic: string;
  onCardsUpdate: (cards: CardData[]) => void;
}

interface GeneratedResponse {
  cards?: CardData[];
  candidates?: CardData[];
  error?: string;
}

export function ContentionEvidenceTab({ topic, onCardsUpdate }: ContentionEvidenceTabProps) {
  const [uniqueness, setUniqueness] = usePersistentState('debate_evidence_uniqueness', '');
  const [warrant, setWarrant] = usePersistentState('debate_evidence_warrant', '');
  const [impact, setImpact] = usePersistentState('debate_evidence_impact', '');
  const [cardCount, setCardCount] = usePersistentState('debate_evidence_card_count', 5);
  const [findUntilStopped, setFindUntilStopped] = usePersistentState('debate_evidence_until_stopped', false);
  const [isFinding, setIsFinding] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [results, setResults] = useState<CardData[]>([]);
  const [allCopied, setAllCopied] = useState(false);
  const stopRequestedRef = useRef(false);

  const handleCopyAllContentionCards = async () => {
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
          .replace(/<mark>/g, '<mark style="background-color:#fff200;color:#332b27;font-weight:bold;">')
          .replace(/<u>/g, '<u style="text-decoration:underline;color:#000;font-size:8.5pt;">');
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
    } catch (copyError) {
      console.error('Failed to copy contention cards.', copyError);
      try {
        await navigator.clipboard.writeText(plainText);
        setAllCopied(true);
        window.setTimeout(() => setAllCopied(false), 2000);
      } catch {
        setError('Could not copy the cards. Check browser clipboard permission and try again.');
      }
    }
  };

  async function findEvidence(event: React.FormEvent) {
    event.preventDefault();
    if (isFinding) return;
    if (!topic.trim()) {
      setError('Add a debate topic in the Auto Card Generator first.');
      return;
    }
    if (!uniqueness.trim() || !warrant.trim() || !impact.trim()) {
      setError('Fill in uniqueness, warrant, and impact so the search knows exactly what to prove.');
      return;
    }

    setIsFinding(true);
    stopRequestedRef.current = false;
    setError('');
    setResults([]);
    try {
      const perEarlyStage = Math.max(1, Math.floor(cardCount / 3));
      const stages = [
        { label: 'uniqueness/status quo', text: uniqueness, cardsNeeded: perEarlyStage, uniqueness, link: '', impact: '', feedback: 'Find evidence proving the uniqueness/status quo claim. Keep the card tightly focused on what is true now and prefer concrete data or measured trends.' },
        { label: 'link/mechanism', text: warrant, cardsNeeded: perEarlyStage, uniqueness: '', link: warrant, impact: '', feedback: 'Find evidence proving the link/mechanism claim. Keep the card tightly focused on how the action changes the status quo and prefer empirical effectiveness evidence.' },
        { label: 'impact/consequence', text: impact, cardsNeeded: cardCount - (perEarlyStage * 2), uniqueness: '', link: '', impact, feedback: 'Find evidence proving the impact/consequence claim. If the impact says an outcome is stopped, prevented, avoided, averted, reduced, or mitigated, find evidence of the negative consequences that outcome would cause—not merely a source saying it was prevented. Prefer the strongest credible large-scale evidence with concrete numbers, percentages, totals, affected-population counts, costs, mortality, or other measured outcomes. If multiple quantified options are usable, prefer the larger material magnitude without comparing unlike measurements or inventing claims.' },
      ];
      const allFoundCards: CardData[] = [];
      const seenCardEvidence = new Set<string>();
      const usedSourceUrls = new Set<string>();
      let sourceRoundsTried = 0;
      let usageLimitReached = false;
      let sourcePoolExhausted = false;
      let consecutiveNoNewSourceRounds = 0;
      const maxNoNewSourceRounds = 9;

      for (let cycle = 0; !stopRequestedRef.current && (findUntilStopped || cycle === 0); cycle += 1) {
        for (const [stageIndex, stage] of stages.entries()) {
          if (stopRequestedRef.current) break;
          let stageCardsFound = 0;
          const stageGoal = findUntilStopped ? 1 : stage.cardsNeeded;

          // Continue using new query rounds and new source batches until this
          // stage is filled. The user can pause at any time from the UI.
          for (let attempt = 0; !stopRequestedRef.current && stageCardsFound < stageGoal; attempt += 1) {
            sourceRoundsTried += 1;
            setStatus(
              findUntilStopped
                ? `Cutting continuously — ${allFoundCards.length} cards found. Searching ${stage.label}…`
                : `Searching fresh sources for ${stage.label} — ${stageCardsFound}/${stageGoal} cards found…`
            );
          const searchResponse = await fetch('/api/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              topic,
              round: cycle * 10000 + stageIndex * 1000 + attempt,
              limit: 8,
              excludeUrls: [...usedSourceUrls],
              targets: [{
                text: stage.text,
                mode: 'Support',
                uniqueness: stage.uniqueness,
                link: stage.link,
                impact: stage.impact,
              }],
            }),
          });
          const searchData = await searchResponse.json() as { results?: Array<{ url: string; title: string }>; error?: string };
            if (!searchResponse.ok) {
              if (searchResponse.status === 429 || searchResponse.status === 413) {
                usageLimitReached = true;
                stopRequestedRef.current = true;
                break;
              }
              throw new Error(searchData.error || `Search failed while finding ${stage.label}.`);
            }

          // Small source batches prevent a single request from exceeding the
          // Groq TPM limit; later rounds supply fresh evidence if a batch fails review.
            const freshArticles = (searchData.results ?? [])
              .filter((article) => !usedSourceUrls.has(article.url))
              .slice(0, 2);
            freshArticles.forEach((article) => usedSourceUrls.add(article.url));
            if (freshArticles.length === 0) {
              consecutiveNoNewSourceRounds += 1;
              if (consecutiveNoNewSourceRounds >= maxNoNewSourceRounds) {
                sourcePoolExhausted = true;
                stopRequestedRef.current = true;
                break;
              }
              continue;
            }
            consecutiveNoNewSourceRounds = 0;

            setStatus(
              findUntilStopped
                ? `Reviewing ${freshArticles.length} fresh sources — ${allFoundCards.length} cards found…`
                : `Reviewing ${freshArticles.length} fresh sources for ${stage.label} — ${stageCardsFound}/${stageGoal} cards found…`
            );
          const generateResponse = await fetch('/api/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              topic,
              targets: [{
                id: `focused_${stage.label.replace(/[^a-z]+/g, '_')}_${cycle}_${stageIndex}_${attempt}`,
                text: stage.text,
                side: 'Affirmative',
                mode: 'Support',
                cardsNeeded: stageGoal - stageCardsFound,
                contention: `Support: ${stage.text}`,
                uniqueness: stage.uniqueness,
                link: stage.link,
                impact: stage.impact,
              }],
              feedback: stage.feedback,
              articles: freshArticles,
              groqApiKeys: [],
              groqApiKeyRotationOffset: cycle * stages.length + stageIndex + attempt,
              includeTagLine: true,
              ...getAiConfigFromStorage('navigator'),
            }),
          });
            const generated = await generateResponse.json() as GeneratedResponse;
            if (!generateResponse.ok || generated.error) {
              if (generateResponse.status === 429 || generateResponse.status === 413) {
                usageLimitReached = true;
                stopRequestedRef.current = true;
                break;
              }
              throw new Error(generated.error || `Generation failed for ${stage.label}.`);
            }
            const newStageCards = (generated.cards ?? [])
            .filter((card) => {
              const evidenceKey = `${card.citation}|${card.bodyHtml}`;
              if (seenCardEvidence.has(evidenceKey)) return false;
              seenCardEvidence.add(evidenceKey);
              return true;
            })
              .slice(0, stageGoal - stageCardsFound);
            if (newStageCards.length > 0) {
              stageCardsFound += newStageCards.length;
              allFoundCards.push(...newStageCards);
              setResults([...allFoundCards]);
              onCardsUpdate(newStageCards);
            }
          }
        }
      }

      setStatus(
        usageLimitReached
          ? `Stopped after ${allFoundCards.length} cards: the AI provider reached its current usage or rate limit.`
          : sourcePoolExhausted
          ? `Stopped after ${allFoundCards.length} cards: search returned no new usable sources for ${maxNoNewSourceRounds} rounds.`
          : stopRequestedRef.current
          ? `Paused after finding ${allFoundCards.length} of ${cardCount} cards.`
          : allFoundCards.length >= cardCount
          ? `Found all ${allFoundCards.length} requested cards across uniqueness, link, and impact.`
          : allFoundCards.length
            ? `Found ${allFoundCards.length} of ${cardCount} cards after checking ${sourceRoundsTried} fresh source rounds.`
            : `No usable evidence cards were found after checking ${sourceRoundsTried} fresh source rounds.`
      );
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Evidence search failed.');
      setStatus('');
    } finally {
      setIsFinding(false);
    }
  }

  return (
    <section className="evidence-tool animate-fade-in">
      <div className="evidence-hero glass">
        <div className="evidence-hero-icon">⌁</div>
        <div>
          <span className="ranker-kicker">FOCUSED RESEARCH</span>
          <h1>Build the contention from evidence</h1>
          <p>Describe the status quo, mechanism, and consequence. The AI will search for sources that prove the complete chain.</p>
        </div>
      </div>

      <form className="evidence-form glass" onSubmit={findEvidence}>
        <div className="evidence-topic"><span>Debate topic</span><strong>{topic || 'No topic set yet'}</strong></div>
        <div className="evidence-fields">
          <label><span><b>01</b> Uniqueness / status quo</span><textarea value={uniqueness} onChange={(event) => setUniqueness(event.target.value)} placeholder="What is true now, and why is the problem urgent?" rows={4} /></label>
          <label><span><b>02</b> Warrant / mechanism</span><textarea value={warrant} onChange={(event) => setWarrant(event.target.value)} placeholder="How does the plan or action change the status quo?" rows={4} /></label>
          <label><span><b>03</b> Impact / consequence</span><textarea value={impact} onChange={(event) => setImpact(event.target.value)} placeholder="What measurable outcome follows, and why does it matter?" rows={4} /></label>
        </div>
        <div className="evidence-form-footer">
          <label className="evidence-count">Cards to find <select value={findUntilStopped ? 'until-stopped' : cardCount} onChange={(event) => {
            if (event.target.value === 'until-stopped') {
              setFindUntilStopped(true);
            } else {
              setFindUntilStopped(false);
              setCardCount(Number(event.target.value));
            }
          }}><option value={3}>3</option><option value={5}>5</option><option value={8}>8</option><option value="until-stopped">Until stopped / API limit</option></select></label>
          {isFinding ? (
            <button type="button" className="btn-primary" onClick={() => { stopRequestedRef.current = true; setStatus('Pausing after the current request…'); }}>Pause search</button>
          ) : (
            <button type="submit" className="btn-primary">{findUntilStopped ? 'Cut until stopped →' : 'Find supporting cards →'}</button>
          )}
        </div>
        {error && <p className="evidence-error">{error}</p>}
        {status && <p className="evidence-status">{status}</p>}
      </form>

      {results.length > 0 && <div className="evidence-results glass"><div className="evidence-results-header"><div><span className="ranker-kicker">EVIDENCE FOUND</span><h2>Supporting cards</h2></div><div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}><span>{results.length} cards added to your workspace</span><button type="button" className="btn-secondary" onClick={handleCopyAllContentionCards} style={{ color: allCopied ? '#10b981' : undefined, whiteSpace: 'nowrap' }}>{allCopied ? '✓ Copied all' : 'Copy all cards'}</button></div></div>{results.map((card) => <Card key={card.id} card={card} />)}</div>}
    </section>
  );
}
