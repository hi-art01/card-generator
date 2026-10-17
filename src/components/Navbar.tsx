'use client';

import React from 'react';

export type TabId =
  | 'auto-carder'
  | 'blox'
  | 'batch-cutter'
  | 'library'
  | 'generator'
  | 'topic-cutter'
  | 'evidence'
  | 'ranker'
  | 'depositories'
  | 'contradictions'
  | 'counter'
  | 'rheotriciser';

interface NavbarProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
}

export function Navbar({ activeTab, onTabChange }: NavbarProps) {
  const tabs: Array<{ id: TabId; label: string }> = [
    { id: 'auto-carder', label: 'Cutter' },
    { id: 'blox', label: 'Blox' },
    { id: 'batch-cutter', label: 'Batch' },
    { id: 'generator', label: 'Prepper' },
    { id: 'topic-cutter', label: 'Topic' },
    { id: 'evidence', label: 'Evidence' },
    { id: 'library', label: 'Library' },
    { id: 'ranker', label: 'Ranker' },
    { id: 'depositories', label: 'Depositories' },
    { id: 'contradictions', label: 'Contradictions' },
    { id: 'counter', label: 'Counter' },
    { id: 'rheotriciser', label: 'Rheotriciser' },
  ];

  return (
    <header className="site-header" style={{ marginBottom: '2rem' }}>
      {/* Editorial Masthead */}
      <div className="masthead" style={{ borderBottom: '2px solid var(--foreground)', paddingBottom: '1.25rem', marginBottom: '1.75rem' }}>
        <p
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '0.72rem',
            textTransform: 'uppercase',
            letterSpacing: '0.25em',
            color: 'var(--muted-foreground)',
            margin: 0,
          }}
          className="masthead-eyebrow"
        >
          Evidence · Blox · Flow Prep
        </p>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem', marginTop: '0.35rem' }}>
          <h1
            className="masthead-title"
            style={{
              fontSize: 'clamp(2rem, 5vw, 3rem)',
              fontWeight: 600,
              fontStyle: 'italic',
              letterSpacing: '-0.025em',
              margin: 0,
              lineHeight: 1.1,
            }}
          >
            Debate Prepper
          </h1>
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '0.72rem',
              textTransform: 'uppercase',
              letterSpacing: '0.15em',
              color: 'var(--muted-foreground)',
            }}
          >
            Est. for the flow
          </span>
        </div>
        <p
          className="masthead-description"
          style={{
            marginTop: '0.5rem',
            marginBottom: 0,
            fontSize: '1rem',
            color: 'var(--muted-foreground)',
            maxWidth: '36rem',
            lineHeight: 1.5,
          }}
        >
          Cut cards from articles, build strategic refutation blocks, or autonomously hunt literature with AI.
        </p>
      </div>

      {/* Underline Tabs */}
      <nav className="nav-tab-container" aria-label="Debate tools">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onTabChange(tab.id)}
              aria-pressed={isActive}
              className={`nav-tab ${isActive ? 'active' : ''}`}
            >
              {tab.label}
            </button>
          );
        })}
      </nav>
    </header>
  );
}
