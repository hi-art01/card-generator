'use client';

import React, { useState } from 'react';
import { Card, CardData } from './Card';
import {
  loadCardLibrary,
  deleteCardFromLibrary,
  clearCardLibrary,
  downloadDoc,
  copyCardsPlain,
  updateCardInLibrary,
} from '../lib/cards';

interface CardLibraryTabProps {
  onSendToRheotriciser?: (card: CardData) => void;
  onSendToRanker?: (card: CardData) => void;
}

export function CardLibraryTab({ onSendToRheotriciser, onSendToRanker }: CardLibraryTabProps) {
  const [cards, setCards] = useState<CardData[]>(() => loadCardLibrary());
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [statusMsg, setStatusMsg] = useState('');

  const refreshLibrary = () => {
    const list = loadCardLibrary();
    setCards(list);
  };

  const filteredCards = cards.filter((c) => {
    const matchesSearch =
      !search.trim() ||
      (c.tag || '').toLowerCase().includes(search.toLowerCase()) ||
      (c.citation || '').toLowerCase().includes(search.toLowerCase()) ||
      (c.author || '').toLowerCase().includes(search.toLowerCase()) ||
      (c.bodyHtml || '').toLowerCase().includes(search.toLowerCase()) ||
      (c.blockTitle || '').toLowerCase().includes(search.toLowerCase());

    const matchesType =
      typeFilter === 'ALL' ||
      (typeFilter === 'BLOX' && c.kind === 'blox') ||
      (c.type || '').toUpperCase() === typeFilter;

    return matchesSearch && matchesType;
  });

  const toggleSelect = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const handleSelectAll = () => {
    if (selectedIds.size === filteredCards.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredCards.map((c) => c.id)));
    }
  };

  const activeCards = selectedIds.size > 0
    ? filteredCards.filter((c) => selectedIds.has(c.id))
    : filteredCards;

  const handleCopy = async () => {
    if (!activeCards.length) return;
    const ok = await copyCardsPlain(activeCards);
    if (ok) {
      setStatusMsg(`Copied ${activeCards.length} card${activeCards.length > 1 ? 's' : ''} to clipboard.`);
      setTimeout(() => setStatusMsg(''), 2500);
    }
  };

  const handleDownload = () => {
    if (!activeCards.length) return;
    downloadDoc(activeCards, 'library-cards.doc', 'Saved Debate Cards');
  };

  const handleDeleteSelected = () => {
    if (!selectedIds.size) return;
    if (confirm(`Delete ${selectedIds.size} selected card(s)?`)) {
      selectedIds.forEach((id) => deleteCardFromLibrary(id));
      setSelectedIds(new Set());
      refreshLibrary();
    }
  };

  const handleClearAll = () => {
    if (confirm('Are you sure you want to delete all saved cards from your browser library?')) {
      clearCardLibrary();
      setSelectedIds(new Set());
      refreshLibrary();
    }
  };

  const handleEditCard = (updated: CardData) => {
    updateCardInLibrary(updated);
    refreshLibrary();
  };

  const pillStyle = (active: boolean): React.CSSProperties => ({
    padding: '0.35rem 0.65rem',
    fontSize: '0.72rem',
    fontFamily: 'var(--font-mono)',
    fontWeight: active ? 600 : 400,
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    borderRadius: 'var(--radius)',
    border: active ? '1px solid var(--primary)' : '1px solid var(--border)',
    background: active ? 'var(--primary)' : 'var(--card)',
    color: active ? 'var(--primary-foreground)' : 'var(--muted-foreground)',
    cursor: 'pointer',
  });

  return (
    <section className="card-box animate-fade-in" style={{ padding: 'clamp(1.2rem, 3.5vw, 2.2rem)' }}>
      <header style={{ marginBottom: '1.6rem' }}>
        <p style={{ margin: '0 0 0.35rem 0', fontFamily: 'var(--font-mono)', color: 'var(--muted-foreground)', fontSize: '0.72rem', fontWeight: 600, letterSpacing: '0.2em', textTransform: 'uppercase' }}>
          Card Library · Persistent Evidence Hub
        </p>
        <h2 style={{ fontSize: '1.85rem', fontWeight: 600, fontStyle: 'italic', marginBottom: '0.45rem', letterSpacing: '-0.02em' }}>
          Saved Debate Cards ({cards.length})
        </h2>
        <p style={{ color: 'var(--muted-foreground)', lineHeight: 1.55, margin: 0, fontSize: '0.92rem' }}>
          All cards saved from the Cutter, Blox, Batch, and Prepper tools live here in your browser storage. Search, filter, export to Microsoft Word .doc, or copy into speech flows.
        </p>
      </header>

      {/* Search and Filters */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.85rem', marginBottom: '1.2rem' }}>
        <input
          type="text"
          placeholder="Search by tag, author, source, warrant…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ fontSize: '0.88rem' }}
        />

        {/* Filter buttons */}
        <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
          {[
            { id: 'ALL', label: 'All' },
            { id: 'BLOX', label: 'Blox' },
            { id: 'AFF', label: 'AFF' },
            { id: 'NEG', label: 'NEG' },
            { id: 'NQ', label: 'NQ' },
            { id: 'DL', label: 'Turn' },
          ].map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTypeFilter(t.id)}
              style={pillStyle(typeFilter === t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Toolbar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem', padding: '0.65rem 0.9rem', background: 'var(--secondary)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <button
            type="button"
            onClick={handleSelectAll}
            className="btn-secondary"
            style={{ fontSize: '0.72rem', padding: '0.3rem 0.65rem' }}
          >
            {selectedIds.size === filteredCards.length && filteredCards.length > 0
              ? 'Deselect All'
              : `Select All (${filteredCards.length})`}
          </button>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.74rem', color: 'var(--muted-foreground)' }}>
            {selectedIds.size > 0 ? `${selectedIds.size} selected` : `${filteredCards.length} matching`}
          </span>
        </div>

        <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={handleCopy}
            disabled={!filteredCards.length}
            className="btn-secondary"
            style={{ fontSize: '0.72rem', padding: '0.3rem 0.65rem' }}
          >
            Copy {selectedIds.size ? 'Selected' : 'All'}
          </button>
          <button
            type="button"
            onClick={handleDownload}
            disabled={!filteredCards.length}
            className="btn-secondary"
            style={{ fontSize: '0.72rem', padding: '0.3rem 0.65rem' }}
          >
            Download .doc
          </button>
          {selectedIds.size > 0 && (
            <button
              type="button"
              onClick={handleDeleteSelected}
              className="btn-secondary"
              style={{ fontSize: '0.72rem', padding: '0.3rem 0.65rem', color: '#b91c1c' }}
            >
              Delete Selected
            </button>
          )}
          {cards.length > 0 && (
            <button
              type="button"
              onClick={handleClearAll}
              className="btn-secondary"
              style={{ fontSize: '0.72rem', padding: '0.3rem 0.65rem', color: '#b91c1c' }}
            >
              Clear All
            </button>
          )}
        </div>
      </div>

      {statusMsg && (
        <div style={{ marginBottom: '1rem', color: '#16a34a', fontSize: '0.82rem', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
          {statusMsg}
        </div>
      )}

      {/* Cards list */}
      {filteredCards.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '3.5rem 1rem', color: 'var(--muted-foreground)' }}>
          <h3 style={{ fontSize: '1.25rem', marginBottom: '0.4rem', fontStyle: 'italic' }}>
            {cards.length === 0 ? 'Your Card Library is Empty' : 'No Cards Match Your Search'}
          </h3>
          <p style={{ fontSize: '0.88rem', margin: 0, color: 'var(--muted-foreground)' }}>
            {cards.length === 0
              ? 'Cut cards using the Cutter, Blox, or Batch tools and click "Save" to build your evidence arsenal.'
              : 'Try clearing your search query or switching filters.'}
          </p>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: '1.25rem' }}>
          {filteredCards.map((card) => {
            const isSelected = selectedIds.has(card.id);
            return (
              <div
                key={card.id}
                style={{
                  position: 'relative',
                  border: isSelected ? '1px solid var(--primary)' : '1px solid transparent',
                  borderRadius: 'var(--radius)',
                  transition: 'border-color 0.2s',
                }}
              >
                <div style={{ position: 'absolute', top: '14px', right: '14px', zIndex: 10 }}>
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.35rem',
                      background: 'var(--secondary)',
                      border: '1px solid var(--border)',
                      padding: '0.2rem 0.5rem',
                      borderRadius: 'var(--radius)',
                      cursor: 'pointer',
                      fontSize: '0.72rem',
                      fontFamily: 'var(--font-mono)',
                      color: isSelected ? 'var(--foreground)' : 'var(--muted-foreground)',
                      fontWeight: 600,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSelect(card.id)}
                      style={{ margin: 0, width: 'auto', cursor: 'pointer' }}
                    />
                    {isSelected ? 'Selected' : 'Select'}
                  </label>
                </div>
                <Card
                  card={card}
                  onEdit={handleEditCard}
                  onSendToRheotriciser={onSendToRheotriciser}
                  onSendToRanker={onSendToRanker}
                />
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
