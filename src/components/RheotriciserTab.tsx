'use client';

import React, { useRef, useState } from 'react';

function parseRgb(color: string): [number, number, number, number] | null {
  if (!color || color === 'transparent') return null;
  const match = color.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)/i);
  if (!match) return null;
  return [
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
    match[4] === undefined ? 1 : Number(match[4]),
  ];
}

function isNearWhite(r: number, g: number, b: number): boolean {
  return r > 245 && g > 245 && b > 245;
}

function isNearBlack(r: number, g: number, b: number): boolean {
  return r < 25 && g < 25 && b < 25;
}

function isReallyBold(el: HTMLElement): boolean {
  const weight = Number.parseInt(getComputedStyle(el).fontWeight, 10);
  return Number.isFinite(weight) && weight >= 600;
}

function isRealHighlight(el: HTMLElement): boolean {
  const tag = el.tagName.toLowerCase();
  if (tag === 'mark') return true;

  const attr = el.getAttribute('style') || '';
  if (/mso-highlight\s*:\s*(?!none)/i.test(attr)) return true;

  const bg = parseRgb(getComputedStyle(el).backgroundColor);
  if (!bg || bg[3] < 0.12) return false;

  const [r, g, b] = bg;
  if (isNearWhite(r, g, b) || isNearBlack(r, g, b)) return false;

  const parent = el.parentElement;
  if (parent) {
    const parentBg = parseRgb(getComputedStyle(parent).backgroundColor);
    if (
      parentBg &&
      parentBg[3] >= 0.12 &&
      Math.abs(parentBg[0] - r) + Math.abs(parentBg[1] - g) + Math.abs(parentBg[2] - b) < 18
    ) {
      return false;
    }
  }

  return true;
}

function isKeptElement(el: HTMLElement): boolean {
  return isRealHighlight(el) || isReallyBold(el);
}

function textShouldStay(node: Text, root: HTMLElement): boolean {
  let parent = node.parentElement;
  while (parent && parent !== root) {
    if (isKeptElement(parent)) return true;
    parent = parent.parentElement;
  }
  return false;
}

function collectTextNodes(root: HTMLElement): Text[] {
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let current: Node | null;
  while ((current = walker.nextNode())) {
    nodes.push(current as Text);
  }
  return nodes;
}

function pruneEmpty(root: HTMLElement): void {
  const elements = Array.from(root.querySelectorAll('*')).reverse();
  for (const el of elements) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'br' || tag === 'img' || tag === 'hr' || tag === 'style') continue;
    if (el.textContent?.trim()) continue;
    if (el.querySelector('br, img, hr')) continue;
    el.remove();
  }
}

function treeHasEmphasis(root: HTMLElement): boolean {
  return Array.from(root.querySelectorAll('*')).some((el) => isKeptElement(el as HTMLElement));
}

function stripUnemphasized(root: HTMLElement): void {
  const nodes = collectTextNodes(root);
  const keptNodes = nodes.filter((node) => textShouldStay(node, root));

  for (const node of nodes) {
    const text = node.textContent ?? '';
    if (/^\s*$/.test(text)) continue;
    if (textShouldStay(node, root)) continue;

    const nodeIndex = nodes.indexOf(node);
    let previousKept: Text | undefined;
    let nextKept: Text | undefined;
    for (const keptNode of keptNodes) {
      const keptIndex = nodes.indexOf(keptNode);
      if (keptIndex < nodeIndex) previousKept = keptNode;
      if (keptIndex > nodeIndex) {
        nextKept = keptNode;
        break;
      }
    }
    if (
      (/^\s/.test(text) || /\s$/.test(text)) &&
      previousKept &&
      nextKept &&
      !/\s$/.test(previousKept.textContent ?? '') &&
      !/^\s/.test(nextKept.textContent ?? '')
    ) {
      previousKept.textContent = `${previousKept.textContent ?? ''} `;
    }

    node.parentNode?.removeChild(node);
  }
  pruneEmpty(root);
}

function keepAllCaps(root: HTMLElement): void {
  for (const node of collectTextNodes(root)) {
    node.textContent = (node.textContent ?? '').replace(/[^\s]+/g, (word) =>
      word.length > 1 && word === word.toUpperCase() && /[A-Z]/.test(word) ? word : ''
    );
  }
  pruneEmpty(root);
}

function extractMsoHtml(dt: DataTransfer): string | null {
  const html = dt.getData('text/html');
  if (html && (html.includes('urn:schemas-microsoft-com:office:word') || html.includes('WordDocument'))) {
    return html;
  }
  return html || null;
}

function pasteFallbackText(editor: HTMLElement, text: string): void {
  const words = text.split(/\s+/).filter(Boolean);
  const frag = document.createDocumentFragment();
  words.forEach((w) => {
    const isCaps = w.length > 1 && w === w.toUpperCase() && /[A-Z]/.test(w);
    if (isCaps) {
      const span = document.createElement('span');
      span.style.fontWeight = 'bold';
      span.style.textDecoration = 'underline';
      span.textContent = `${w} `;
      frag.appendChild(span);
    } else {
      const span = document.createElement('span');
      span.style.fontSize = '8pt';
      span.style.color = '#888';
      span.textContent = `${w} `;
      frag.appendChild(span);
    }
  });
  editor.innerHTML = '';
  editor.appendChild(frag);
}

async function copyFromEditor(editor: HTMLElement): Promise<void> {
  const html = editor.innerHTML;
  const text = editor.innerText;

  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
    try {
      const blobHtml = new Blob([html], { type: 'text/html' });
      const blobText = new Blob([text], { type: 'text/plain' });
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': blobHtml,
          'text/plain': blobText,
        }),
      ]);
      return;
    } catch {
      // fallback below
    }
  }

  const sel = window.getSelection();
  if (sel) {
    sel.removeAllRanges();
    const range = document.createRange();
    range.selectNodeContents(editor);
    sel.addRange(range);
    document.execCommand('copy');
    sel.removeAllRanges();
  }
}

export function RheotriciserTab() {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const [hasInput, setHasInput] = useState(false);
  const [mode, setMode] = useState<'html' | 'allcaps'>('html');
  const [copied, setCopied] = useState(false);

  const syncHasInput = () => {
    const text = editorRef.current?.innerText ?? '';
    setHasInput(text.trim().length > 0);
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    const dt = e.clipboardData;
    if (!dt) return;

    const html = extractMsoHtml(dt);
    const plain = dt.getData('text/plain');

    if (html && (html.includes('<mark') || html.includes('mso-highlight') || html.includes('<b>') || html.includes('<strong>') || html.includes('font-weight'))) {
      setMode('html');
    } else if (plain) {
      const words = plain.split(/\s+/).filter(Boolean);
      const caps = words.filter((w) => w.length > 1 && w === w.toUpperCase() && /[A-Z]/.test(w));
      if (caps.length >= 2) {
        e.preventDefault();
        const editor = editorRef.current;
        if (editor) {
          pasteFallbackText(editor, plain);
          setMode('allcaps');
          setHasInput(true);
          return;
        }
      }
    }

    setTimeout(() => {
      syncHasInput();
    }, 0);
  };

  const handleRheotricise = () => {
    const editor = editorRef.current;
    if (!editor) return;

    if (mode === 'html' && treeHasEmphasis(editor)) {
      stripUnemphasized(editor);
    } else {
      keepAllCaps(editor);
    }

    syncHasInput();
    setCopied(false);
  };

  const handleClear = () => {
    setHasInput(false);
    setCopied(false);
    if (editorRef.current) {
      editorRef.current.innerHTML = '';
    }
  };

  const handleCopy = async () => {
    const editor = editorRef.current;
    if (!editor) return;
    if (!editor.innerText.trim() && !editor.innerHTML.trim()) return;
    try {
      await copyFromEditor(editor);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  return (
    <section className="card-box animate-fade-in" style={{ padding: 'clamp(1.2rem, 3.5vw, 2.2rem)' }}>
      <header style={{ marginBottom: '1.6rem' }}>
        <p style={{ margin: '0 0 0.35rem 0', fontFamily: 'var(--font-mono)', color: 'var(--muted-foreground)', fontSize: '0.72rem', fontWeight: 600, letterSpacing: '0.2em', textTransform: 'uppercase' }}>
          Speech Delivery · Warrants & Highlighting
        </p>
        <h2 style={{ fontSize: '1.85rem', fontWeight: 600, fontStyle: 'italic', marginBottom: '0.45rem', letterSpacing: '-0.02em' }}>
          Rheotriciser
        </h2>
        <p style={{ color: 'var(--muted-foreground)', lineHeight: 1.55, margin: 0, fontSize: '0.92rem' }}>
          Paste text from a debate card or document. The tool deletes everything that isn&apos;t{' '}
          <strong style={{ color: 'var(--foreground)' }}>bolded</strong> or{' '}
          <mark style={{ background: '#fff200', color: 'var(--foreground)', padding: '0 3px', borderRadius: '2px' }}>
            highlighted
          </mark>
          , keeping original formatting and sizing for speed reading.
        </p>
      </header>

      <div style={{ marginBottom: '1.2rem' }}>
        <label
          style={{
            display: 'block',
            fontFamily: 'var(--font-mono)',
            fontSize: '0.72rem',
            color: 'var(--foreground)',
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            marginBottom: '0.4rem',
          }}
        >
          Paste card text here (Ctrl+V / ⌘V):
        </label>

        <div
          ref={editorRef}
          className="rheotriciser-editor"
          contentEditable
          suppressContentEditableWarning
          onPaste={handlePaste}
          onInput={syncHasInput}
          style={{
            minHeight: '160px',
            padding: '1rem',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            fontSize: '0.88rem',
            lineHeight: 1.6,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            outline: 'none',
            cursor: 'text',
            overflowY: 'auto',
            maxHeight: '520px',
            background: '#ffffff',
          }}
          aria-label="Paste area"
        />

        {!hasInput && (
          <p style={{ margin: '0.4rem 0 0', color: 'var(--muted-foreground)', fontSize: '0.76rem' }}>
            Rich-text paste (from Word, Google Docs, etc.) reads formatting directly. Plain-text paste falls back to keeping ALL-CAPS words.
          </p>
        )}
      </div>

      <div
        style={{
          display: 'flex',
          gap: '0.65rem',
          flexWrap: 'wrap',
          alignItems: 'center',
        }}
      >
        <button
          type="button"
          className="btn-primary"
          onClick={handleRheotricise}
          disabled={!hasInput}
          style={{ opacity: hasInput ? 1 : 0.55 }}
        >
          Rheotricise
        </button>

        {hasInput && (
          <>
            <button
              type="button"
              onClick={handleCopy}
              className="btn-secondary"
              style={{
                fontSize: '0.74rem',
                padding: '0.4rem 0.8rem',
                color: copied ? '#16a34a' : undefined,
                borderColor: copied ? '#16a34a' : undefined,
              }}
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button
              type="button"
              onClick={handleClear}
              className="btn-secondary"
              style={{ fontSize: '0.74rem', padding: '0.4rem 0.8rem' }}
            >
              Clear
            </button>
          </>
        )}

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--muted-foreground)' }}>Mode:</span>
          <button
            type="button"
            onClick={() => setMode(mode === 'html' ? 'allcaps' : 'html')}
            className="btn-secondary"
            style={{
              padding: '0.3rem 0.6rem',
              fontSize: '0.72rem',
            }}
          >
            {mode === 'html' ? 'Rich-text' : 'ALL-CAPS'}
          </button>
        </div>
      </div>
    </section>
  );
}
