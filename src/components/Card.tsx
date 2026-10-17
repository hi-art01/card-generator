'use client';

import React, { useState } from 'react';
import { DebateCard, saveCardToLibrary, downloadDoc, copyCardRich, formatCardPlain } from '../lib/cards';

export interface CardQualityRating {
  score: number;
  label: string;
  rationale: string;
}

export type CardData = DebateCard;

interface CardProps {
  card: CardData;
  onEdit?: (updatedCard: CardData) => void;
  onSendToRheotriciser?: (card: CardData) => void;
  onSendToRanker?: (card: CardData) => void;
}

export function Card({ card, onEdit, onSendToRheotriciser, onSendToRanker }: CardProps) {
  const [copied, setCopied] = useState(false);
  const [copiedPlain, setCopiedPlain] = useState(false);
  const [saved, setSaved] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [sourceDetailsOpen, setSourceDetailsOpen] = useState(false);

  // Edit states
  const [editTag, setEditTag] = useState(card.tag);
  const [editCitation, setEditCitation] = useState(card.citation);
  const [editBody, setEditBody] = useState(card.bodyHtml);

  const hasTag = (card.tag || '').trim().length > 0;
  const qualityRating = card.qualityRating;
  const cleanReasoning = (card.reasoning || '').replace(/^(uniqueness|link|impact|warrant)\s*:\s*/i, '');
  const sourceUrl = card.sourceUrl && /^https?:\/\//i.test(card.sourceUrl) ? card.sourceUrl : '';
  const sourceTitle = card.sourceTitle?.trim() || '';
  const authorLine = card.author?.trim() || 'Author not listed';
  const qualificationsLine = card.authorQualifications?.trim() || 'Qualifications not published';

  const handleCopyRich = async () => {
    const ok = await copyCardRich(card);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleCopyPlain = async () => {
    const text = formatCardPlain(card);
    try {
      await navigator.clipboard.writeText(text);
      setCopiedPlain(true);
      setTimeout(() => setCopiedPlain(false), 2000);
    } catch {
      // ignore
    }
  };

  const handleSave = () => {
    saveCardToLibrary(card);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const handleDownload = () => {
    const filename = `${(card.author || 'debate-card').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.doc`;
    downloadDoc([card], filename, card.tag || 'Debate Card');
  };

  const handleSaveEdit = () => {
    const updated: CardData = {
      ...card,
      tag: editTag,
      citation: editCitation,
      bodyHtml: editBody,
    };
    if (onEdit) onEdit(updated);
    setIsEditing(false);
  };

  const getBadgeClass = (type?: string) => {
    const t = (type || 'AFF').toUpperCase();
    if (t.includes('AFF')) return 'badge-aff';
    if (t.includes('NEG')) return 'badge-neg';
    if (t.includes('NQ')) return 'badge-nq';
    if (t.includes('NL')) return 'badge-nl';
    if (t.includes('DL')) return 'badge-dl';
    if (t.includes('T')) return 'badge-t';
    return 'badge-aff';
  };

  return (
    <article
      className="card-box animate-fade-in"
      style={{
        padding: '1.5rem',
        marginBottom: '1.25rem',
        background: 'var(--card)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
      }}
    >
      {/* Header and metadata */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 260 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap', marginBottom: '0.45rem' }}>
            <span className={`badge ${getBadgeClass(card.type)}`}>
              {card.type || 'CARD'}
            </span>
            {card.kind === 'blox' && (
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.68rem',
                  padding: '0.15rem 0.5rem',
                  borderRadius: 'var(--radius)',
                  background: 'var(--secondary)',
                  border: '1px solid var(--border)',
                  color: 'var(--foreground)',
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                }}
              >
                Blox
              </span>
            )}
            {card.blockTitle && (
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.68rem',
                  color: 'var(--muted-foreground)',
                  background: 'var(--secondary)',
                  border: '1px solid var(--border)',
                  padding: '0.15rem 0.5rem',
                  borderRadius: 'var(--radius)',
                }}
              >
                {card.blockTitle}
              </span>
            )}
            {card.contention && !card.blockTitle && (
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.68rem',
                  color: 'var(--muted-foreground)',
                  background: 'var(--secondary)',
                  border: '1px solid var(--border)',
                  padding: '0.15rem 0.5rem',
                  borderRadius: 'var(--radius)',
                }}
              >
                {card.contention}
              </span>
            )}
          </div>

          {!isEditing ? (
            <>
              {hasTag && (
                <h3
                  style={{
                    margin: '0.35rem 0 0.5rem 0',
                    fontSize: '1.25rem',
                    fontWeight: 700,
                    color: 'var(--foreground)',
                    lineHeight: 1.3,
                    fontFamily: 'var(--font-serif)',
                  }}
                >
                  {card.tag}
                </h3>
              )}
              <p
                style={{
                  fontSize: '0.88rem',
                  color: 'var(--muted-foreground)',
                  marginBottom: '0.75rem',
                  fontStyle: 'italic',
                  lineHeight: 1.45,
                  fontFamily: 'var(--font-serif)',
                }}
              >
                {card.citation}
              </p>
            </>
          ) : (
            <div style={{ margin: '0.6rem 0', display: 'grid', gap: '0.6rem' }}>
              <div>
                <label style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--muted-foreground)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  Tag:
                </label>
                <input
                  type="text"
                  value={editTag}
                  onChange={(e) => setEditTag(e.target.value)}
                  style={{ fontSize: '0.9rem', fontWeight: 700, marginTop: '2px' }}
                />
              </div>
              <div>
                <label style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--muted-foreground)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  Citation:
                </label>
                <input
                  type="text"
                  value={editCitation}
                  onChange={(e) => setEditCitation(e.target.value)}
                  style={{ fontSize: '0.84rem', marginTop: '2px' }}
                />
              </div>
            </div>
          )}

          {/* Sourcing dropdown */}
          {(sourceTitle || sourceUrl || card.author || card.authorQualifications) && (
            <div style={{ marginBottom: '0.75rem' }}>
              <button
                type="button"
                onClick={() => setSourceDetailsOpen((open) => !open)}
                className="btn-secondary"
                aria-expanded={sourceDetailsOpen}
                style={{ padding: '0.2rem 0.55rem', fontSize: '0.7rem' }}
              >
                {sourceDetailsOpen ? 'Hide source' : 'Source details'}
              </button>
              {sourceDetailsOpen && (
                <div
                  style={{
                    marginTop: '0.5rem',
                    fontSize: '0.8rem',
                    lineHeight: 1.5,
                    color: 'var(--foreground)',
                    background: 'var(--secondary)',
                    border: '1px solid var(--border)',
                    padding: '0.65rem 0.85rem',
                    borderRadius: 'var(--radius)',
                  }}
                >
                  {sourceTitle && (
                    <div>
                      <strong style={{ color: 'var(--foreground)' }}>Publication: </strong>
                      {sourceUrl ? (
                        <a href={sourceUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--primary)', textDecoration: 'underline' }}>
                          {sourceTitle}
                        </a>
                      ) : sourceTitle}
                    </div>
                  )}
                  {sourceUrl && !sourceTitle && (
                    <div>
                      <strong style={{ color: 'var(--foreground)' }}>Source: </strong>
                      <a href={sourceUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--primary)', textDecoration: 'underline' }}>
                        {sourceUrl}
                      </a>
                    </div>
                  )}
                  <div><strong style={{ color: 'var(--foreground)' }}>Author: </strong>{authorLine}</div>
                  <div><strong style={{ color: 'var(--foreground)' }}>Qualifications: </strong>{qualificationsLine}</div>
                </div>
              )}
            </div>
          )}

          {cleanReasoning && (
            <p
              style={{
                fontSize: '0.82rem',
                color: 'var(--muted-foreground)',
                marginBottom: '0.75rem',
                background: 'var(--secondary)',
                padding: '0.5rem 0.75rem',
                borderRadius: 'var(--radius)',
                borderLeft: '2px solid var(--primary)',
              }}
            >
              {cleanReasoning}
            </p>
          )}

          {qualityRating && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  padding: '0.15rem 0.5rem',
                  borderRadius: 'var(--radius)',
                  background: 'var(--secondary)',
                  border: '1px solid var(--border)',
                  color: 'var(--primary)',
                  fontWeight: 700,
                  fontSize: '0.75rem',
                  fontFamily: 'var(--font-mono)',
                }}
              >
                Score {qualityRating.score}/10
              </span>
              <span style={{ color: 'var(--muted-foreground)', fontSize: '0.82rem' }}>
                <strong style={{ color: 'var(--foreground)' }}>{qualityRating.label}</strong>
                {qualityRating.rationale ? ` — ${qualityRating.rationale}` : ''}
              </span>
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'wrap' }}>
          <button
            onClick={handleCopyRich}
            className="btn-secondary"
            title="Copy for Microsoft Word or Verbatim with high-contrast formatting"
            style={{
              padding: '0.35rem 0.65rem',
              fontSize: '0.72rem',
              color: copied ? '#16a34a' : undefined,
              borderColor: copied ? '#16a34a' : undefined,
            }}
          >
            {copied ? 'Copied' : 'Copy (Word)'}
          </button>

          <button
            onClick={handleCopyPlain}
            className="btn-secondary"
            title="Copy as plain text"
            style={{ padding: '0.35rem 0.6rem', fontSize: '0.72rem' }}
          >
            {copiedPlain ? 'Copied' : 'Text'}
          </button>

          <button
            onClick={handleSave}
            className="btn-secondary"
            title="Save this card into your persistent Card Library"
            style={{
              padding: '0.35rem 0.65rem',
              fontSize: '0.72rem',
              color: saved ? '#16a34a' : undefined,
              borderColor: saved ? '#16a34a' : undefined,
            }}
          >
            {saved ? 'Saved' : 'Save'}
          </button>

          <button
            onClick={handleDownload}
            className="btn-secondary"
            title="Download this card as a Microsoft Word .doc file"
            style={{ padding: '0.35rem 0.6rem', fontSize: '0.72rem' }}
          >
            .doc
          </button>

          {onSendToRheotriciser && (
            <button
              onClick={() => onSendToRheotriciser(card)}
              className="btn-secondary"
              title="Send to Rheotriciser for speech read-aloud bolding & highlighting"
              style={{ padding: '0.35rem 0.6rem', fontSize: '0.72rem' }}
            >
              Rheotriciser
            </button>
          )}

          {onSendToRanker && (
            <button
              onClick={() => onSendToRanker(card)}
              className="btn-secondary"
              title="Evaluate this card in the Card Ranker"
              style={{ padding: '0.35rem 0.6rem', fontSize: '0.72rem' }}
            >
              Rank
            </button>
          )}

          {!isEditing ? (
            <button
              onClick={() => setIsEditing(true)}
              className="btn-secondary"
              title="Edit card tag, citation, or body"
              style={{ padding: '0.35rem 0.6rem', fontSize: '0.72rem' }}
            >
              Edit
            </button>
          ) : (
            <button
              onClick={handleSaveEdit}
              className="btn-primary"
              style={{ padding: '0.35rem 0.75rem', fontSize: '0.72rem' }}
            >
              Save
            </button>
          )}
        </div>
      </div>

      {/* Card body */}
      {!isEditing ? (
        <div
          className="card-content"
          style={{ marginTop: '0.85rem', paddingTop: '0.85rem', borderTop: '1px solid var(--border)' }}
          dangerouslySetInnerHTML={{ __html: card.bodyHtml }}
        />
      ) : (
        <div style={{ marginTop: '0.85rem', paddingTop: '0.85rem', borderTop: '1px solid var(--border)' }}>
          <label style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--muted-foreground)', fontWeight: 600, display: 'block', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Edit Evidence HTML (&lt;mark&gt; and &lt;u&gt;):
          </label>
          <textarea
            rows={8}
            value={editBody}
            onChange={(e) => setEditBody(e.target.value)}
            style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', width: '100%' }}
          />
        </div>
      )}
    </article>
  );
}
