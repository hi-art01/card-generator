export interface DebateCard {
  id: string;
  tag: string;
  citation: string;
  bodyHtml: string;
  type?: string; // AFF | NEG | NQ | NL | DL | T | Blox | Batch | etc.
  contention?: string;
  reasoning?: string;
  sourceTitle?: string;
  sourceUrl?: string;
  author?: string;
  authorQualifications?: string;
  publishedDate?: string;
  savedAt?: string;
  kind?: 'card' | 'blox' | 'counter';
  blockTitle?: string;
  combatClaim?: string;
  qualityRating?: {
    score: number;
    label: string;
    rationale: string;
  };
}

export interface DebateBlock {
  id: string;
  title: string;
  side: 'Affirmative' | 'Negative' | 'Neutral';
  claim: string;
  warrant: string;
  impact: string;
  frontlinePoints?: string[];
  cards: DebateCard[];
  createdAt: string;
}

const STORAGE_KEY = 'debate_cards_library_v1';
const BLOCKS_STORAGE_KEY = 'debate_blocks_library_v1';

export function loadCardLibrary(): DebateCard[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function persistCardLibrary(cards: DebateCard[]): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cards));
}

export function saveCardToLibrary(card: DebateCard): DebateCard {
  const existing = loadCardLibrary();
  // Prevent duplicate by matching id or tag+citation
  const duplicateIdx = existing.findIndex(
    (c) => c.id === card.id || (c.tag === card.tag && c.citation === card.citation)
  );
  const entry: DebateCard = {
    ...card,
    id: card.id || `card_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    savedAt: card.savedAt || new Date().toISOString(),
  };

  if (duplicateIdx >= 0) {
    existing[duplicateIdx] = entry;
    persistCardLibrary(existing);
  } else {
    persistCardLibrary([entry, ...existing]);
  }
  return entry;
}

export function updateCardInLibrary(card: DebateCard): void {
  const cards = loadCardLibrary().map((c) => (c.id === card.id ? card : c));
  persistCardLibrary(cards);
}

export function deleteCardFromLibrary(id: string): void {
  const cards = loadCardLibrary().filter((c) => c.id !== id);
  persistCardLibrary(cards);
}

export function clearCardLibrary(): void {
  persistCardLibrary([]);
}

export function loadBlocksLibrary(): DebateBlock[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(BLOCKS_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveBlockToLibrary(block: DebateBlock): void {
  if (typeof window === 'undefined') return;
  const existing = loadBlocksLibrary().filter((b) => b.id !== block.id);
  localStorage.setItem(BLOCKS_STORAGE_KEY, JSON.stringify([block, ...existing]));
  // Also save all child cards to the card library
  block.cards.forEach((card) => {
    saveCardToLibrary({
      ...card,
      kind: 'blox',
      blockTitle: block.title,
    });
  });
}

function escapeHtml(s: string): string {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function formatCardPlain(card: DebateCard): string {
  const tag = (card.tag || '').trim();
  const cite = (card.citation || '').trim();
  const plainBody = (card.bodyHtml || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .trim();

  return [tag, cite, plainBody].filter(Boolean).join('\n\n');
}

export function formatCardRichHtml(card: DebateCard): string {
  const hasTag = (card.tag || '').trim().length > 0;
  const formattedBodyHtml = (card.bodyHtml || '')
    .replace(/<mark\b[^>]*>/gi, '<mark style="background-color: #00f0ff; color: #001b2e; font-weight: bold; padding: 1px 2px; border-radius: 2px;">')
    .replace(/<u\b[^>]*>/gi, '<u style="text-decoration: underline; color: #000000; font-size: 9.5pt;">');

  return `
<div style="font-family: Calibri, 'Times New Roman', Arial, sans-serif; margin-bottom: 24px; color: #000000;">
  ${hasTag ? `<h3 style="margin: 0 0 4px 0; font-size: 13pt; font-weight: bold; color: #000000;">${card.tag}</h3>` : ''}
  <p style="margin: 4px 0 10px 0; font-size: 10pt; color: #111111;"><i>${card.citation}</i></p>
  <div style="font-size: 8.5pt; line-height: 1.45; color: #444444;">
    ${formattedBodyHtml}
  </div>
</div>
`.trim();
}

export async function copyCardRich(card: DebateCard): Promise<boolean> {
  const html = formatCardRichHtml(card);
  const plain = formatCardPlain(card);
  try {
    if (navigator.clipboard && window.ClipboardItem) {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([plain], { type: 'text/plain' }),
        }),
      ]);
      return true;
    }
    await navigator.clipboard.writeText(plain);
    return true;
  } catch {
    try {
      await navigator.clipboard.writeText(plain);
      return true;
    } catch {
      return false;
    }
  }
}

export async function copyCardsPlain(cards: DebateCard[]): Promise<boolean> {
  const text = cards.map(formatCardPlain).join('\n\n====================\n\n');
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function cardsToHtmlDoc(cards: DebateCard[], docTitle = 'Debate Evidence Cards'): string {
  const cardsHtml = cards
    .map((c, i) => {
      const cite = c.citation || `${c.author || 'Author'} (${c.publishedDate || 'n.d.'})`;
      const cleanBody = (c.bodyHtml || '')
        .replace(/<mark\b[^>]*>/gi, '<mark style="background-color: #ffff00; color: #000000; font-weight: bold;">')
        .replace(/<u\b[^>]*>/gi, '<u style="text-decoration: underline; color: #000000;">')
        .replace(/font-size:\s*8pt/gi, 'font-size: 8.5pt');

      return `
      <div style="margin-bottom: 24pt;">
        <p style="font-weight:bold; font-size:13pt; margin:0 0 4pt 0; color:#000000;">${i + 1}. ${escapeHtml(c.tag)}</p>
        <p style="font-size:10pt; margin:0 0 8pt 0; color:#222222;"><i>${escapeHtml(cite)}</i></p>
        <div style="font-size:8.5pt; line-height:1.45; color:#444444;">${cleanBody}</div>
      </div>
      `;
    })
    .join('<br style="page-break-before:always" />');

  return `
    <html xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
    <head>
      <meta charset="utf-8" />
      <title>${escapeHtml(docTitle)}</title>
      <style>
        body { font-family: 'Calibri', 'Times New Roman', serif; margin: 1in; }
        mark { background-color: #ffff00; font-weight: bold; }
        u { text-decoration: underline; }
      </style>
    </head>
    <body>
      <h1 style="font-size:18pt; margin-bottom:12pt; border-bottom:2px solid #000; padding-bottom:6pt;">${escapeHtml(docTitle)}</h1>
      ${cardsHtml}
    </body>
    </html>
  `.trim();
}

export function downloadDoc(cards: DebateCard[], filename = 'debate-cards.doc', title = 'Debate Cards'): void {
  if (typeof window === 'undefined' || !cards.length) return;
  const htmlContent = cardsToHtmlDoc(cards, title);
  const blob = new Blob(['\ufeff', htmlContent], { type: 'application/msword;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function downloadBlockDoc(block: DebateBlock): void {
  if (typeof window === 'undefined') return;
  const title = `Block: ${block.title}`;
  const filename = `${block.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.doc`;

  const frontlineHtml = block.frontlinePoints && block.frontlinePoints.length
    ? `<div style="background:#f1f5f9; padding:10pt; margin-bottom:16pt; border-left:4pt solid #3b82f6;">
        <p style="font-weight:bold; font-size:11pt; margin:0 0 6pt 0;">FRONTLINE TALKING POINTS:</p>
        <ul>${block.frontlinePoints.map((p) => `<li style="font-size:10pt; margin-bottom:3pt;">${escapeHtml(p)}</li>`).join('')}</ul>
       </div>`
    : '';

  const blockHeaderHtml = `
    <div style="margin-bottom:20pt; border-bottom:2pt solid #1e293b; padding-bottom:12pt;">
      <h1 style="font-size:18pt; margin:0 0 6pt 0;">${escapeHtml(block.title)}</h1>
      <p style="font-size:11pt; margin:0 0 4pt 0;"><b>Claim:</b> ${escapeHtml(block.claim)}</p>
      <p style="font-size:11pt; margin:0 0 4pt 0;"><b>Warrant:</b> ${escapeHtml(block.warrant)}</p>
      <p style="font-size:11pt; margin:0 0 8pt 0;"><b>Impact:</b> ${escapeHtml(block.impact)}</p>
      ${frontlineHtml}
    </div>
  `;

  const cardsHtml = block.cards.map((c, i) => `
    <div style="margin-bottom: 24pt;">
      <p style="font-weight:bold; font-size:13pt; margin:0 0 4pt 0;">${i + 1}. ${escapeHtml(c.tag)}</p>
      <p style="font-size:10pt; margin:0 0 8pt 0;"><i>${escapeHtml(c.citation)}</i></p>
      <div style="font-size:8.5pt; line-height:1.45; color:#444444;">${c.bodyHtml}</div>
    </div>
  `).join('<br style="page-break-before:always" />');

  const fullDoc = `
    <html xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
    <head><meta charset="utf-8" /><title>${escapeHtml(title)}</title></head>
    <body style="font-family:'Calibri', 'Times New Roman', serif; margin:1in;">
      ${blockHeaderHtml}
      ${cardsHtml}
    </body>
    </html>
  `.trim();

  const blob = new Blob(['\ufeff', fullDoc], { type: 'application/msword;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function countWords(text: string): number {
  const t = (text || '').trim();
  return t ? t.split(/\s+/).length : 0;
}
