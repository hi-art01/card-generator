export const NEON_BLUE = '#00f0ff';
export const NEON_BLUE_BG = '#00f0ff';
export const NEON_BLUE_TEXT = '#001b2e';

export interface CitationMetadata {
  author?: string;
  publishedDate?: string;
  qualifications?: string;
  title?: string;
  url?: string;
  initials?: string;
}

export function formatDebateCitation(meta: CitationMetadata): string {
  const author = (meta.author || 'Author').trim();
  
  // Extract year for the bold head
  let year = new Date().getFullYear().toString();
  if (meta.publishedDate) {
    const yearMatch = meta.publishedDate.match(/\b(19\d\d|20\d\d)\b/);
    if (yearMatch) year = yearMatch[1];
  }

  // Format specific date like MM-DD-YYYY or YYYY-MM-DD
  let specificDate = meta.publishedDate || `${new Date().toISOString().slice(5, 7)}-${new Date().toISOString().slice(8, 10)}-${year}`;
  const dateMatch = meta.publishedDate?.match(/(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (dateMatch) {
    const p1 = dateMatch[1].padStart(2, '0');
    const p2 = dateMatch[2].padStart(2, '0');
    const p3 = dateMatch[3].length === 2 ? `20${dateMatch[3]}` : dateMatch[3];
    specificDate = `${p1}-${p2}-${p3}`;
  }

  const quals = meta.qualifications?.trim() || 'Debate Policy Analyst, Expert Staff Researcher';
  const title = meta.title?.trim() || 'Research Document';
  const url = meta.url?.trim() || '';
  const initials = meta.initials?.trim() || 'awy';

  // Tech debate standard: Author Name date published [author quals, specific date(like xx-xx-xxxx), article title, website link]/awy
  return `${author} ${year} [${quals}, ${specificDate}, "${title}", ${url}]/${initials}`;
}

export function normalizeEvidenceText(value: string): string {
  return value
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function stripEvidenceHtml(value: string): string {
  return normalizeEvidenceText(
    value
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<[^>]*>/g, ' ')
  );
}

export function sanitizeEvidenceHtml(value: unknown): string {
  if (typeof value !== 'string') return '';

  return value
    .replace(/<(mark|u|strong|span)\b[^>]*>/gi, (match) => {
      if (match.toLowerCase().includes('debate-small-text') || match.toLowerCase().includes('font-size: 8pt')) {
        return '<span class="debate-small-text" style="font-size: 8pt; color: #64748b; font-weight: normal; line-height: 1.4;">';
      }
      if (match.toLowerCase().startsWith('<mark')) {
        return '<mark style="background-color: #00f0ff; color: #001b2e; font-weight: 600; padding: 1px 2px; border-radius: 2px;">';
      }
      if (match.toLowerCase().startsWith('<u')) {
        return '<u style="text-decoration: underline; color: inherit; font-size: 10pt;">';
      }
      return match.replace(/style="[^"]*"/gi, '');
    })
    .replace(/<\/(mark|u|strong|span)>/gi, '</$1>')
    .replace(/<br\s*\/?>/gi, '<br>')
    .replace(/<(p|div)\b[^>]*>/gi, '')
    .replace(/<\/(p|div)>/gi, '<br>')
    .replace(/<(?!\/?(?:mark|u|strong|span|br)\b)[^>]*>/gi, '')
    .replace(/(?:<br>\s*){3,}/gi, '<br><br>')
    .trim();
}

/**
 * Ensures tech debate markup formatting:
 * 1. Neon blue read-aloud highlights (<mark style="background-color: #00f0ff...">)
 * 2. Surrounding context underlined (<u>...</u>)
 * 3. Unread context rendered in small text
 */
export function emphasizeReadAloudKeywords(value: string): string {
  const sanitized = sanitizeEvidenceHtml(value);

  // Wrap any text outside <mark> and <u> in small text if not already wrapped
  return sanitized.replace(/<mark\b[^>]*>([\s\S]*?)<\/mark>/gi, (_match, markedText: string) => {
    return `<mark style="background-color: #00f0ff; color: #001b2e; font-weight: 600; padding: 1px 2px; border-radius: 2px;">${markedText}</mark>`;
  });
}

export function isEvidenceFromSource(bodyHtml: string, sourceText: string): boolean {
  const quote = stripEvidenceHtml(bodyHtml);
  const source = normalizeEvidenceText(sourceText);
  return quote.length >= 40 && source.toLowerCase().includes(quote.toLowerCase());
}

export function buildEvidenceFallback(sourceText: string, focus = ''): string {
  const source = normalizeEvidenceText(sourceText);
  const terms = focus.toLowerCase().split(/\W+/).filter((term) => term.length > 3);
  const sentences = source.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [source];
  const ranked = sentences
    .map((sentence, index) => ({
      sentence: sentence.trim(),
      index,
      score: terms.reduce(
        (total, term) => total + (sentence.toLowerCase().includes(term) ? 2 : 0),
        /(because|therefore|causes?|increases?|decreases?|study|report|percent|%|data|finds?|according)/i.test(sentence) ? 1 : 0
      ),
    }))
    .filter(({ sentence }) => sentence.length >= 40)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, 2)
    .sort((a, b) => a.index - b.index)
    .map(({ sentence }) => sentence);

  const selected = (ranked.length ? ranked : sentences.slice(0, 2))
    .join(' ')
    .trim()
    .slice(0, 1000);
  const warrantMatch = selected.match(/^(.{35,260}?[.!?])(?:\s|$)/);
  const warrant = warrantMatch?.[1] || selected;
  const context = warrantMatch ? selected.slice(warrant.length).trim() : '';
  return `<u><mark style="background-color: #00f0ff; color: #001b2e; font-weight: 600;">${escapeHtml(warrant)}</mark>${context ? ` ${escapeHtml(context)}` : ''}</u>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
