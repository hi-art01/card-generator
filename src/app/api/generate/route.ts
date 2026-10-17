import { NextResponse } from 'next/server';
import * as cheerio from 'cheerio';
import OpenAI from 'openai';
import { getCompatibleBaseUrl, getCompatibleModel, AiProviderType } from '../../../lib/aiProvider';
import { isBannedUrl } from '../../../lib/domainFilters';
import { emphasizeReadAloudKeywords } from '../../../lib/evidence';

type TargetMode = 'Attack' | 'Support' | 'Defend';
type TargetSide = 'Affirmative' | 'Negative' | 'Support';
type CardType = 'AFF' | 'NEG' | 'NQ' | 'NL' | 'DL' | 'T';
type ContentionField = 'UNIQUENESS' | 'LINK' | 'IMPACT';
type EvidenceDirection = 'PROVES_TARGET_TRUE' | 'PROVES_TARGET_FALSE' | 'IRRELEVANT';
type ReviewDecision = 'KEEP' | 'REJECT';
type ReviewRelation = 'SUPPORTS_TARGET' | 'REFUTES_TARGET' | 'TANGENTIAL' | 'UNCLEAR';
type ReviewScope = 'WHOLE_TARGET' | 'PARTIAL' | 'TANGENTIAL' | 'UNCLEAR';
type ReviewTagAccuracy = 'ACCURATE' | 'OVERCLAIMED' | 'MISALIGNED' | 'UNCLEAR';
type ChatCompletionRequest = OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming;
type ChatCompletionResponse = OpenAI.Chat.Completions.ChatCompletion;

interface GenerationTarget {
  id: string;
  text: string;
  side: TargetSide;
  mode: TargetMode;
  cardsNeeded: number;
  feedback?: string;
  contention?: string;
  uniqueness?: string;
  link?: string;
  impact?: string;
}

interface GeneratedCard {
  targetId: string;
  evidenceDirection: EvidenceDirection;
  id: string;
  reasoning: string;
  tag: string;
  citation: string;
  bodyHtml: string;
  type: CardType | string;
  contentionField?: ContentionField | string;
  contention?: string;
  sourceTitle?: string;
  sourceUrl?: string;
  author?: string;
  authorQualifications?: string;
}

type CandidateStage = 'strict' | 'fallback' | 'rescue' | 'rejected';

interface CandidateCardPayload extends GeneratedCard {
  contention: string;
  status: 'accepted' | 'rejected';
  validationStage: CandidateStage;
  note: string;
}

interface SourceBlock {
  id: string;
  title: string;
  url: string;
  text: string;
  normalizedText: string;
  paragraphs: string[];
  domain: string;
  author?: string;
  authorQualifications?: string;
  publishedDate?: string;
  siteName?: string;
}

interface SourceRepair {
  sourceBlock: SourceBlock;
  repairedBodyHtml: string;
  repairedCitation: string;
}

interface SourcePromptChunk {
  sourceBlock: SourceBlock;
  text: string;
  chunkNumber: number;
  chunkCount: number;
}

interface ReviewCardResult {
  id: string;
  decision: ReviewDecision;
  relation: ReviewRelation;
  scope: ReviewScope;
  tagAccuracy: ReviewTagAccuracy;
  correctedTag?: string;
  correctedReasoning?: string;
  correctedType?: string;
  rejectionReason?: string;
}

interface TargetRule {
  allowedTypes: CardType[];
  expectedEvidenceDirection: EvidenceDirection;
  expectedReviewRelation: Extract<ReviewRelation, 'SUPPORTS_TARGET' | 'REFUTES_TARGET'>;
  missionLabel: string;
  wholeTargetTest: string;
  antiDriftWarning: string;
}

const VALID_CARD_TYPES = new Set<CardType>(['AFF', 'NEG', 'NQ', 'NL', 'DL', 'T']);
const DEFAULT_GROQ_API_KEY = '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';
const STOP_WORDS = new Set([
  'about',
  'after',
  'against',
  'because',
  'before',
  'being',
  'between',
  'could',
  'every',
  'first',
  'from',
  'have',
  'into',
  'more',
  'other',
  'should',
  'since',
  'than',
  'that',
  'their',
  'there',
  'these',
  'they',
  'this',
  'those',
  'through',
  'under',
  'very',
  'what',
  'when',
  'which',
  'while',
  'with',
  'would',
]);

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function buildStructuredTargetLines(
  target: Pick<GenerationTarget, 'uniqueness' | 'link' | 'impact'>
): string[] {
  return [
    target.uniqueness?.trim() ? `- Uniqueness/status quo: ${normalizeWhitespace(target.uniqueness)}` : '',
    target.link?.trim() ? `- Link/mechanism: ${normalizeWhitespace(target.link)}` : '',
    target.impact?.trim() ? `- Impact/changed outcome: ${normalizeWhitespace(target.impact)}` : '',
  ].filter(Boolean);
}

function buildTargetContentionLabel(target: GenerationTarget): string {
  const structuredParts = [
    target.uniqueness?.trim() ? `Uniqueness: ${normalizeWhitespace(target.uniqueness)}` : '',
    target.link?.trim() ? `Link: ${normalizeWhitespace(target.link)}` : '',
    target.impact?.trim() ? `Impact: ${normalizeWhitespace(target.impact)}` : '',
  ].filter(Boolean);

  return `[${target.side}] ${
    structuredParts.length > 0 ? structuredParts.join(' | ') : normalizeWhitespace(target.text)
  }`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function cleanMetadataValue(value?: string | null): string | undefined {
  if (!value) {
    return undefined;
  }

  const cleaned = normalizeWhitespace(value);
  return cleaned || undefined;
}

function extractAuthorQualifications($: cheerio.CheerioAPI, author?: string): string | undefined {
  const visibleBio = cleanMetadataValue(
    $('[class*="author-bio" i], [class*="author__bio" i], [class*="byline" i] [class*="title" i], [itemprop="jobTitle"]').first().text()
  );
  let structuredQualification: string | undefined;

  $('script[type="application/ld+json"]').each((_, element) => {
    if (structuredQualification) return;
    try {
      const raw = JSON.parse($(element).contents().text()) as unknown;
      const nodes = Array.isArray(raw)
        ? raw
        : raw && typeof raw === 'object' && '@graph' in raw && Array.isArray((raw as { '@graph'?: unknown[] })['@graph'])
          ? (raw as { '@graph': unknown[] })['@graph']
          : [raw];
      for (const node of nodes) {
        if (!node || typeof node !== 'object') continue;
        const authors = Array.isArray((node as { author?: unknown }).author)
          ? (node as { author: unknown[] }).author
          : [(node as { author?: unknown }).author];
        for (const entry of authors) {
          if (!entry || typeof entry !== 'object') continue;
          const person = entry as { name?: unknown; jobTitle?: unknown; affiliation?: unknown; worksFor?: unknown };
          const personName = typeof person.name === 'string' ? person.name.trim() : '';
          if (author && personName && !author.toLowerCase().includes(personName.toLowerCase())) continue;
          const jobTitle = typeof person.jobTitle === 'string' ? person.jobTitle.trim() : '';
          const organization = [person.affiliation, person.worksFor]
            .map((value) => typeof value === 'string' ? value : value && typeof value === 'object' && typeof (value as { name?: unknown }).name === 'string' ? (value as { name: string }).name : '')
            .find(Boolean);
          const qualification = [jobTitle, organization].filter(Boolean).join(', ');
          if (qualification) {
            structuredQualification = qualification;
            return;
          }
        }
      }
    } catch {
      // Ignore malformed JSON-LD; only source-published author information is used.
    }
  });

  return structuredQualification || visibleBio;
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, '');
  } catch {
    return 'custom-source';
  }
}

function splitIntoParagraphs(text: string): string[] {
  return text
    .split(/\n{2,}/)
    .map((paragraph) => normalizeWhitespace(paragraph))
    .filter(Boolean);
}

function extractYear(value?: string): string {
  if (!value) {
    return 'n.d.';
  }

  const match = value.match(/\b(19|20)\d{2}\b/);
  return match?.[0] ?? 'n.d.';
}

function formatCitationDate(value?: string): string {
  if (!value) {
    return 'undated';
  }

  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    return `${parsed.getMonth() + 1}-${parsed.getDate()}-${parsed.getFullYear()}`;
  }

  return value.replace(/T.*$/, '').slice(0, 40);
}

function buildCitationFromSourceBlock(sourceBlock: SourceBlock): string {
  const author = sourceBlock.author || sourceBlock.siteName || sourceBlock.domain;
  const year = extractYear(sourceBlock.publishedDate);
  const date = formatCitationDate(sourceBlock.publishedDate);
  const quals = sourceBlock.authorQualifications || sourceBlock.siteName || 'Staff Researcher';

  return `${author} ${year} [${quals}, ${date}, "${sourceBlock.title}", ${sourceBlock.url}]/awy`;
}

function extractPublishedYearFromCitation(citation?: string): string | null {
  if (!citation) {
    return null;
  }

  const explicitMatch = citation.match(/,\s((?:19|20)\d{2})\s*\[/);
  if (explicitMatch) {
    return explicitMatch[1];
  }

  return null;
}

function appendPublishedYearToTag(tag: string, citation?: string): string {
  const trimmedTag = tag.trim();
  if (!trimmedTag) {
    return trimmedTag;
  }

  const publishedYear = extractPublishedYearFromCitation(citation);
  if (!publishedYear) {
    return trimmedTag;
  }

  if (new RegExp(`(?:\\[|\\()${publishedYear}(?:\\]|\\))`).test(trimmedTag)) {
    return trimmedTag;
  }

  return `${trimmedTag} [${publishedYear}]`;
}

function normalizeGeneratedCardId(card: GeneratedCard, index: number): string {
  const bodySnippet = normalizeWhitespace(card.bodyHtml || '').slice(0, 80);
  const rawBase = [
    card.targetId,
    card.id,
    card.type,
    card.citation,
    bodySnippet,
    String(index + 1),
  ]
    .filter(Boolean)
    .join('_');

  const normalized = rawBase
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 140);

  return normalized || `card_${index + 1}`;
}

function ensureUniqueGeneratedCardIds(cards: GeneratedCard[]): GeneratedCard[] {
  const seenIds = new Map<string, number>();

  return cards.map((card, index) => {
    const baseId = normalizeGeneratedCardId(card, index);
    const seenCount = (seenIds.get(baseId) ?? 0) + 1;
    seenIds.set(baseId, seenCount);

    return {
      ...card,
      id: seenCount === 1 ? baseId : `${baseId}__${seenCount}`,
    };
  });
}

function buildPromptSourceContext(sourceBlocks: SourceBlock[]): string {
  return sourceBlocks
    .map(
      (sourceBlock, index) =>
        `\n--- ARTICLE ${index + 1} ---\nSOURCE ID: ${sourceBlock.id}\nTITLE: ${sourceBlock.title}\nURL: ${sourceBlock.url}\nTEXT:\n${sourceBlock.text}\n`
    )
    .join('');
}

const FULL_PAGE_CHUNK_MAX_CHARS = 2800;

function splitParagraphForPrompt(paragraph: string): string[] {
  if (paragraph.length <= FULL_PAGE_CHUNK_MAX_CHARS) {
    return [paragraph];
  }

  const sentences = paragraph.match(/[^.!?]+(?:[.!?]+|$)/g) || [paragraph];
  const pieces: string[] = [];
  let current = '';
  sentences.forEach((sentence) => {
    const next = current ? `${current} ${sentence.trim()}` : sentence.trim();
    if (next.length > FULL_PAGE_CHUNK_MAX_CHARS && current) {
      pieces.push(current);
      current = sentence.trim();
    } else {
      current = next;
    }
  });
  if (current) pieces.push(current);
  return pieces;
}

function buildFullPagePromptChunks(sourceBlocks: SourceBlock[]): SourcePromptChunk[] {
  const chunks: SourcePromptChunk[] = [];

  sourceBlocks.forEach((sourceBlock) => {
    const paragraphs = (sourceBlock.paragraphs.length > 0 ? sourceBlock.paragraphs : [sourceBlock.text])
      .map((paragraph) => normalizeWhitespace(paragraph))
      .filter(Boolean)
      .flatMap(splitParagraphForPrompt);
    const sourceChunks: string[] = [];
    let current = '';

    paragraphs.forEach((paragraph) => {
      const next = current ? `${current}\n\n${paragraph}` : paragraph;
      if (next.length > FULL_PAGE_CHUNK_MAX_CHARS && current) {
        sourceChunks.push(current);
        current = paragraph;
      } else {
        current = next;
      }
    });
    if (current) sourceChunks.push(current);

    sourceChunks.forEach((text, index) => {
      chunks.push({
        sourceBlock,
        text,
        chunkNumber: index + 1,
        chunkCount: sourceChunks.length,
      });
    });
  });

  return chunks;
}

function normalizeGroqApiKeys(groqApiKeys?: string[], groqApiKey?: string, directApiKey?: string): string[] {
  const direct = directApiKey?.trim() || groqApiKey?.trim();
  const allKeys = [
    ...(direct ? [direct] : []),
    ...(groqApiKeys ?? []),
    ...(process.env.GROQ_API_KEY ? [process.env.GROQ_API_KEY] : []),
    ...(process.env.OMNIROUTERS_API_KEY ? [process.env.OMNIROUTERS_API_KEY] : []),
    DEFAULT_GROQ_API_KEY,
  ];

  return Array.from(
    new Set(
      allKeys
        .map((key) => key.trim())
        .filter(Boolean)
    )
  );
}

function prioritizeApiKey(apiKeys: string[], preferredApiKey?: string): string[] {
  if (!preferredApiKey || !apiKeys.includes(preferredApiKey)) {
    return apiKeys;
  }

  return [preferredApiKey, ...apiKeys.filter((apiKey) => apiKey !== preferredApiKey)];
}

function rotateApiKeys(apiKeys: string[], rotationOffset = 0): string[] {
  if (apiKeys.length <= 1) {
    return apiKeys;
  }

  const normalizedOffset = ((rotationOffset % apiKeys.length) + apiKeys.length) % apiKeys.length;
  return [...apiKeys.slice(normalizedOffset), ...apiKeys.slice(0, normalizedOffset)];
}

function createGroqClient(apiKey: string, customBaseUrl?: string, providerType?: AiProviderType): OpenAI {
  return new OpenAI({
    apiKey,
    baseURL: getCompatibleBaseUrl(apiKey, customBaseUrl, providerType),
  });
}

function shouldFailOverToNextKey(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const status = 'status' in error && typeof error.status === 'number' ? error.status : undefined;
  const message = error.message.toLowerCase();

  if (status === 401 || status === 403 || status === 429) {
    return true;
  }

  return (
    message.includes('rate limit') ||
    message.includes('too many requests') ||
    message.includes('quota') ||
    message.includes('invalid api key') ||
    message.includes('authentication') ||
    message.includes('unauthorized')
  );
}

async function createCompletionWithKeyRotation(
  apiKeys: string[],
  request: ChatCompletionRequest,
  localOptions?: {
    providerMode?: 'cloud' | 'local' | 'auto';
    providerType?: AiProviderType;
    apiKey?: string;
    baseUrl?: string;
    model?: string;
    density?: 'tech' | 'lay';
    localBaseUrl?: string;
    localModel?: string;
    localApiKey?: string;
  }
): Promise<{ response: ChatCompletionResponse; usedApiKey: string }> {
  const localBaseUrl = localOptions?.localBaseUrl?.trim() || 'http://localhost:11434/v1';
  const localModel = localOptions?.localModel?.trim() || 'llama3.2';
  const localApiKey = localOptions?.localApiKey?.trim() || 'ollama-local-key';

  if (localOptions?.providerMode === 'local') {
    const localClient = new OpenAI({ apiKey: localApiKey, baseURL: localBaseUrl });
    const response = await localClient.chat.completions.create({
      ...request,
      model: localModel,
    });
    return { response, usedApiKey: 'local-open-weight' };
  }

  let lastError: unknown;
  let exhaustedFailoverPool = false;

  for (const apiKey of apiKeys) {
    try {
      const client = createGroqClient(apiKey, localOptions?.baseUrl, localOptions?.providerType);
      const targetModel = localOptions?.model?.trim() || getCompatibleModel(apiKey, request.model, localOptions?.providerType);
      const response = await client.chat.completions.create({
        ...request,
        model: targetModel,
      });
      return { response, usedApiKey: apiKey };
    } catch (error) {
      lastError = error;
      if (!shouldFailOverToNextKey(error)) {
        throw error;
      }

      exhaustedFailoverPool = true;
      console.warn('Groq key failed, falling back to next key.', error);
    }
  }

  if (exhaustedFailoverPool || localOptions?.providerMode === 'auto') {
    // Attempt local open-weight model fallback so card cutting never stops
    try {
      console.warn(`Groq keys exhausted or rate-limited. Falling back to local model (${localModel} at ${localBaseUrl})...`);
      const localClient = new OpenAI({ apiKey: localApiKey, baseURL: localBaseUrl });
      const response = await localClient.chat.completions.create({
        ...request,
        model: localModel,
      });
      return { response, usedApiKey: 'local-open-weight-fallback' };
    } catch (localErr) {
      console.error('Local open-weight fallback failed:', localErr);
    }

    const failoverError = new Error(
      lastError instanceof Error
        ? `All Groq API keys appear rate-limited or unavailable. Last error: ${lastError.message}`
        : 'All Groq API keys appear rate-limited or unavailable.'
    ) as Error & { code?: string; status?: number };
    failoverError.code = 'API_KEYS_OVERUSED';
    failoverError.status = 429;
    throw failoverError;
  }

  throw lastError ?? new Error('No working Groq API keys were available.');
}

function stripHtml(html: unknown): string {
  return typeof html === 'string' ? html.replace(/<[^>]+>/g, ' ') : '';
}

function extractMarkedText(html: unknown): string {
  if (typeof html !== 'string') {
    return '';
  }
  const marks = [...html.matchAll(/<mark[^>]*>([\s\S]*?)<\/mark>/gi)];
  return normalizeWhitespace(
    marks
      .map((match) => stripHtml(match[1] ?? ''))
      .join(' ')
  );
}

function hasMarkTag(html: unknown): boolean {
  return typeof html === 'string' && /<mark\b[^>]*>/i.test(html);
}

function parseTagPrefix(tag: string): CardType | null {
  const prefix = tag.trim().match(/^([A-Z]{1,3})\)/)?.[1];
  if (!prefix) return null;

  return VALID_CARD_TYPES.has(prefix as CardType) ? (prefix as CardType) : null;
}

function stripTagPrefix(tag: string): string {
  return tag.trim().replace(/^[A-Z]{1,3}\)\s*/, '').trim();
}

function extractFocusTerms(targets: GenerationTarget[]): string[] {
  return Array.from(
    new Set(
      targets.flatMap((target) =>
        [target.text, target.uniqueness, target.link, target.impact]
          .filter((value): value is string => Boolean(value?.trim()))
          .join(' ')
          .toLowerCase()
          .split(/[^a-z0-9]+/)
          .filter((term) => term.length >= 4 && !STOP_WORDS.has(term))
      )
    )
  ).slice(0, 24);
}

function scoreParagraph(paragraph: string, focusTerms: string[]): number {
  const lowerParagraph = paragraph.toLowerCase();
  const focusScore = focusTerms.reduce((score, term) => {
    if (!lowerParagraph.includes(term)) {
      return score;
    }

    return score + (term.length >= 8 ? 2 : 1);
  }, 0);
  const evidenceSignal = /(\b\d+(?:\.\d+)?(?:\s?%|\s?(?:million|billion|thousand))?\b|\b(?:study|data|analysis|report|finds?|found|evidence|causes?|leads? to|results? in|increases?|decreases?|reduces?|prevents?)\b)/i.test(paragraph)
    ? 2
    : 0;
  return focusScore + evidenceSignal;
}

function buildRelevantExcerpt(
  paragraphs: string[],
  focusTerms: string[],
  maxChars = 3500
): string {
  const cleanedParagraphs = paragraphs
    .map((paragraph) => paragraph.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  if (cleanedParagraphs.length === 0) {
    return '';
  }

  if (focusTerms.length === 0) {
    return cleanedParagraphs.join('\n\n').slice(0, maxChars).trim();
  }

  const scoredParagraphs = cleanedParagraphs.map((paragraph, index) => ({
    paragraph,
    index,
    score: scoreParagraph(paragraph, focusTerms),
  }));

  const topMatches = scoredParagraphs
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, 8);

  if (topMatches.length === 0) {
    return cleanedParagraphs.join('\n\n').slice(0, maxChars).trim();
  }

  const keptIndexes = new Set<number>();
  topMatches.forEach(({ index }) => {
    for (
      let paragraphIndex = Math.max(0, index - 2);
      paragraphIndex <= Math.min(cleanedParagraphs.length - 1, index + 2);
      paragraphIndex += 1
    ) {
      keptIndexes.add(paragraphIndex);
    }
  });

  // Keep the strongest matches first, so a useful card near the end of a
  // page is not crowded out just because earlier background appears first.
  const priorityIndexes = topMatches.flatMap(({ index }) => [index, index - 1, index + 1])
    .filter((index) => keptIndexes.has(index));
  const selectedIndexes = new Set<number>();
  let usedChars = 0;
  for (const index of priorityIndexes) {
    if (selectedIndexes.has(index)) continue;
    const length = cleanedParagraphs[index].length + 2;
    if (selectedIndexes.size > 0 && usedChars + length > maxChars) continue;
    selectedIndexes.add(index);
    usedChars += length;
  }
  const excerpt = [...selectedIndexes]
    .sort((a, b) => a - b)
    .map((index) => cleanedParagraphs[index])
    .join('\n\n')
    .slice(0, maxChars)
    .trim();

  return excerpt.trim();
}

function findBestSourceBlock(card: GeneratedCard, sourceBlocks: SourceBlock[]): SourceBlock | null {
  const markedText = extractMarkedText(card.bodyHtml);
  if (markedText.length < 25) {
    return null;
  }

  const bodyText = normalizeWhitespace(stripHtml(card.bodyHtml));
  const bodyFragments = bodyText
    .split(/[.!?]/)
    .map((fragment) => normalizeWhitespace(fragment))
    .filter((fragment) => fragment.length >= 45)
    .sort((a, b) => b.length - a.length)
    .slice(0, 4);

  let bestMatch: { block: SourceBlock; score: number } | null = null;

  for (const sourceBlock of sourceBlocks) {
    let score = 0;

    if (sourceBlock.normalizedText.includes(markedText)) {
      score += 10;
    }

    bodyFragments.forEach((fragment) => {
      if (sourceBlock.normalizedText.includes(fragment)) {
        score += 1;
      }
    });

    if (!bestMatch || score > bestMatch.score) {
      bestMatch = { block: sourceBlock, score };
    }
  }

  if (!bestMatch || bestMatch.score < 10) {
    return null;
  }

  return bestMatch.block;
}

function expandToCompleteWarrant(
  paragraph: string,
  matchStart: number,
  matchLength: number
): { start: number; end: number } {
  const sentencePattern = /[^.!?]+(?:[.!?]+|$)/g;
  const sentences: Array<{ start: number; end: number }> = [];
  let sentenceMatch: RegExpExecArray | null;

  while ((sentenceMatch = sentencePattern.exec(paragraph)) !== null) {
    const start = sentenceMatch.index;
    const end = start + sentenceMatch[0].length;
    if (sentenceMatch[0].trim()) {
      sentences.push({ start, end });
    }
  }

  const matchedSentenceIndex = sentences.findIndex(
    (sentence) => matchStart >= sentence.start && matchStart < sentence.end
  );
  if (matchedSentenceIndex < 0) {
    return { start: matchStart, end: matchStart + matchLength };
  }

  const matchedSentence = sentences[matchedSentenceIndex];
  let start = matchedSentence.start;
  let end = matchedSentence.end;

  // A card needs more than an isolated keyword or one short sentence. Keep a
  // connected read-aloud block: the central claim plus its data, qualifier,
  // mechanism, or consequence. The cap keeps the visual emphasis useful.
  for (
    let index = matchedSentenceIndex + 1;
    index < sentences.length && index <= matchedSentenceIndex + 3;
    index += 1
  ) {
    if (sentences[index].end - start > 700) break;
    end = sentences[index].end;
  }

  if (
    end - start < 180 &&
    matchedSentenceIndex > 0 &&
    end - sentences[matchedSentenceIndex - 1].start <= 700
  ) {
    start = sentences[matchedSentenceIndex - 1].start;
  }

  return { start, end };
}

function buildRepairedBodyHtml(sourceBlock: SourceBlock, markedText: string): string | null {
  let markedParagraphIndex = -1;
  let markedParagraphHtml = '';

  for (let index = 0; index < sourceBlock.paragraphs.length; index += 1) {
    const paragraph = sourceBlock.paragraphs[index];
    const normalizedParagraph = normalizeWhitespace(paragraph);
    const matchStart = normalizedParagraph.indexOf(markedText);

    if (matchStart >= 0) {
      const highlightRange = expandToCompleteWarrant(
        normalizedParagraph,
        matchStart,
        markedText.length
      );
      markedParagraphIndex = index;
      markedParagraphHtml = [
        highlightRange.start > 0
          ? `<u>${escapeHtml(normalizedParagraph.slice(0, highlightRange.start))}</u>`
          : '',
        `<mark>${escapeHtml(normalizedParagraph.slice(highlightRange.start, highlightRange.end))}</mark>`,
        highlightRange.end < normalizedParagraph.length
          ? `<u>${escapeHtml(normalizedParagraph.slice(highlightRange.end))}</u>`
          : '',
      ].join('');
      break;
    }
  }

  if (markedParagraphIndex < 0 || !markedParagraphHtml) {
    return null;
  }

  const startIndex = Math.max(0, markedParagraphIndex - 2);
  const endIndex = Math.min(sourceBlock.paragraphs.length - 1, markedParagraphIndex + 2);
  const rebuiltParagraphs: string[] = [];

  for (let index = startIndex; index <= endIndex; index += 1) {
    if (index === markedParagraphIndex) {
      rebuiltParagraphs.push(`<p>${markedParagraphHtml}</p>`);
      continue;
    }

    rebuiltParagraphs.push(`<p><u>${escapeHtml(normalizeWhitespace(sourceBlock.paragraphs[index]))}</u></p>`);
  }

  return emphasizeReadAloudKeywords(rebuiltParagraphs.join(''));
}

function repairCardAgainstSource(card: GeneratedCard, sourceBlocks: SourceBlock[]): SourceRepair | null {
  const markedText = extractMarkedText(card.bodyHtml);
  if (markedText.length < 25) {
    return null;
  }

  const sourceBlock = findBestSourceBlock(card, sourceBlocks);
  if (!sourceBlock) {
    return null;
  }

  const repairedBodyHtml = buildRepairedBodyHtml(sourceBlock, markedText);
  if (!repairedBodyHtml) {
    return null;
  }

  return {
    sourceBlock,
    repairedBodyHtml,
    repairedCitation: buildCitationFromSourceBlock(sourceBlock),
  };
}

function isCardBodyVerbatimFromSource(bodyHtml: string, normalizedSourceContext: string): boolean {
  const bodyText = normalizeWhitespace(stripHtml(bodyHtml));
  const markedText = extractMarkedText(bodyHtml);

  if (bodyText.length < 200 || markedText.length < 25) {
    return false;
  }

  return normalizedSourceContext.includes(bodyText) && normalizedSourceContext.includes(markedText);
}

function getTargetRule(target: GenerationTarget): TargetRule {
  if (target.mode === 'Support') {
    return {
      allowedTypes: ['AFF'],
      expectedEvidenceDirection: 'PROVES_TARGET_TRUE',
      expectedReviewRelation: 'SUPPORTS_TARGET',
      missionLabel: 'Support the target statement with usable evidence',
      wholeTargetTest:
        'Approve if the highlighted evidence directly proves the target statement or strongly supports a central warrant, mechanism, or impact that would be usable in a speech defending it.',
      antiDriftWarning:
        'Reject cards if the quote only gives generic background, a tiny stray detail, or something too indirect to be useful in defending the target.',
    };
  }

  if (target.mode === 'Defend') {
    if (target.side === 'Affirmative') {
      return {
        allowedTypes: ['AFF'],
        expectedEvidenceDirection: 'PROVES_TARGET_TRUE',
        expectedReviewRelation: 'SUPPORTS_TARGET',
        missionLabel: 'Defend the affirmative contention from opponent responses, turns, and takeout arguments',
        wholeTargetTest:
          'Approve if the highlighted evidence defends the affirmative contention against a typical negative response, such as: re-establishing uniqueness against a non-uniqueness argument, proving solvency or the link mechanism is real despite objections, answering a turn or backlash argument, showing no internal link exists to a claimed harm, or proving a disadvantage impact is overstated.',
        antiDriftWarning:
          'Reject cards that only generally support the contention without addressing how it survives a challenge. The evidence must function as a defensive answer to an objection, not merely as further proof of the original claim.',
      };
    }

    return {
      allowedTypes: ['NEG'],
      expectedEvidenceDirection: 'PROVES_TARGET_TRUE',
      expectedReviewRelation: 'SUPPORTS_TARGET',
      missionLabel: 'Defend the negative contention from affirmative responses and attacks',
      wholeTargetTest:
        'Approve if the highlighted evidence defends the negative contention against a typical affirmative response, such as: re-establishing uniqueness, proving the link or mechanism is real despite objections, answering a turn, showing the affirmative plan does not solve the disadvantage, or proving a solvency objection is unfounded.',
      antiDriftWarning:
        'Reject cards that only generally support the contention without addressing how it survives a challenge. The evidence must function as a defensive answer to an objection, not merely further proof of the original claim.',
    };
  }

  if (target.side === 'Affirmative') {
    return {
      allowedTypes: ['NQ', 'NL', 'DL', 'T'],
      expectedEvidenceDirection: 'PROVES_TARGET_FALSE',
      expectedReviewRelation: 'REFUTES_TARGET',
      missionLabel: 'Refute the affirmative contention',
      wholeTargetTest:
        'Approve if the highlighted evidence undercuts the contention as a whole or provides a materially usable debate takeout against it, including non-uniqueness/status quo already solving, no-solvency or no-link, an alternative cause or actor solving better, or a turn showing the contention makes things worse.',
      antiDriftWarning:
        'Reject cards that discuss only a tiny side issue, a throwaway example, or something the affirmative could still comfortably use to defend the contention. Do not reject a card merely because it does not literally restate the target outcome if it still gives a real debate takeout against the contention.',
    };
  }

  return {
    allowedTypes: ['AFF'],
    expectedEvidenceDirection: 'PROVES_TARGET_FALSE',
    expectedReviewRelation: 'REFUTES_TARGET',
    missionLabel: 'Refute the negative contention',
    wholeTargetTest:
      'Approve if the highlighted evidence undercuts the negative contention as written or provides a materially usable debate takeout against it, including non-uniqueness/status quo already solving, no-solvency or no-link, an alternative cause or actor solving better, or a turn showing the negative contention makes things worse.',
    antiDriftWarning:
      'Reject cards that only hit a tiny side point, drift to a different claim, or could still be comfortably used by the negative side. Do not reject a card merely because it does not literally restate the target outcome if it still gives a real debate takeout against the contention.',
  };
}

function buildTargetConstraint(target: GenerationTarget): string {
  const rule = getTargetRule(target);
  const structuredTargetLines = buildStructuredTargetLines(target);

  return [
    `[TARGET ID: ${target.id}]`,
    `Mission: ${rule.missionLabel}.`,
    `Need: ${target.cardsNeeded} card(s).`,
    `Allowed Type Prefixes: ${rule.allowedTypes.join(', ')}.`,
    `Expected Evidence Direction: ${rule.expectedEvidenceDirection}.`,
    `Materiality Test: ${rule.wholeTargetTest}`,
    `Anti-Drift Rule: ${rule.antiDriftWarning}`,
    `Target Text: "${normalizeWhitespace(target.text)}"`,
    structuredTargetLines.length > 0
      ? `Contention Chain:\n${structuredTargetLines.join('\n')}`
      : '',
  ].join('\n');
}

function normalizeCardAfterReview(
  card: GeneratedCard,
  target: GenerationTarget,
  review?: ReviewCardResult,
  includeTagLine = true,
  sourceRepair?: SourceRepair
): GeneratedCard | null {
  const rule = getTargetRule(target);
  const rawTag = (review?.correctedTag || card.tag || '').trim();
  const rawReasoning = (review?.correctedReasoning || card.reasoning || '').trim();
  const finalCitation = sourceRepair?.repairedCitation?.trim() || card.citation?.trim();
  const finalBodyHtml = sourceRepair?.repairedBodyHtml?.trim() || card.bodyHtml?.trim();

  if (!rawReasoning || !finalCitation || !finalBodyHtml) {
    return null;
  }

  const preferredType =
    (review?.correctedType?.trim().toUpperCase() as CardType | undefined) ||
    parseTagPrefix(rawTag) ||
    (typeof card.type === 'string' ? (card.type.trim().toUpperCase() as CardType) : null) ||
    parseTagPrefix(card.tag || '') ||
    rule.allowedTypes[0];

  const finalType = rule.allowedTypes.includes(preferredType) ? preferredType : rule.allowedTypes[0];
  const tagBody = stripTagPrefix(rawTag);

  if (includeTagLine && !tagBody) {
    return null;
  }

  return {
    ...card,
    citation: finalCitation,
    bodyHtml: finalBodyHtml,
    sourceTitle: sourceRepair?.sourceBlock.title || card.sourceTitle,
    sourceUrl: sourceRepair?.sourceBlock.url || card.sourceUrl,
    author: sourceRepair?.sourceBlock.author || card.author,
    authorQualifications: sourceRepair?.sourceBlock.authorQualifications || card.authorQualifications,
    type: finalType,
    tag: includeTagLine ? appendPublishedYearToTag(`${finalType}) ${tagBody}`, finalCitation) : '',
    reasoning: rawReasoning,
  };
}

function getDeclaredCardType(card: GeneratedCard, review?: ReviewCardResult): CardType | null {
  const candidates = [
    review?.correctedType?.trim().toUpperCase(),
    parseTagPrefix(review?.correctedTag || ''),
    typeof card.type === 'string' ? card.type.trim().toUpperCase() : null,
    parseTagPrefix(card.tag || ''),
  ];

  for (const candidate of candidates) {
    if (candidate && VALID_CARD_TYPES.has(candidate as CardType)) {
      return candidate as CardType;
    }
  }

  return null;
}

function isCardTypeCompatible(
  card: GeneratedCard,
  target: GenerationTarget,
  review?: ReviewCardResult
): boolean {
  const declaredType = getDeclaredCardType(card, review);
  if (!declaredType) {
    return true;
  }

  return getTargetRule(target).allowedTypes.includes(declaredType);
}

function isEvidenceDirectionCompatible(card: GeneratedCard, target: GenerationTarget): boolean {
  return card.evidenceDirection === getTargetRule(target).expectedEvidenceDirection;
}

function isReviewExplicitlyWrongSide(
  review: ReviewCardResult | undefined,
  expectedRelation: TargetRule['expectedReviewRelation']
): boolean {
  if (!review) {
    return false;
  }

  if (review.relation === 'TANGENTIAL') {
    return true;
  }

  if (
    expectedRelation === 'REFUTES_TARGET' &&
    review.relation === 'SUPPORTS_TARGET'
  ) {
    return true;
  }

  if (
    expectedRelation === 'SUPPORTS_TARGET' &&
    review.relation === 'REFUTES_TARGET'
  ) {
    return true;
  }

  return false;
}

function mergeValidatedCards(...cardSets: GeneratedCard[][]): GeneratedCard[] {
  const merged = new Map<string, GeneratedCard>();

  cardSets.forEach((cardSet) => {
    cardSet.forEach((card) => {
      if (!merged.has(card.id)) {
        merged.set(card.id, card);
      }
    });
  });

  return [...merged.values()];
}

function buildCandidateDisplayCard(
  card: GeneratedCard,
  target: GenerationTarget | undefined,
  review: ReviewCardResult | undefined,
  includeTagLine: boolean,
  sourceRepair: SourceRepair | null | undefined
): GeneratedCard {
  if (target) {
    const normalizedCard = normalizeCardAfterReview(
      card,
      target,
      review,
      includeTagLine,
      sourceRepair ?? undefined
    );
    if (normalizedCard) {
      return normalizedCard;
    }
  }

  const fallbackType =
    (review?.correctedType?.trim().toUpperCase() as CardType | undefined) ||
    parseTagPrefix(review?.correctedTag || '') ||
    (typeof card.type === 'string' ? card.type.trim().toUpperCase() : '') ||
    parseTagPrefix(card.tag || '') ||
    'AFF';

  return {
    ...card,
    type: VALID_CARD_TYPES.has(fallbackType as CardType) ? fallbackType : 'AFF',
    tag: includeTagLine
      ? appendPublishedYearToTag(
          (review?.correctedTag || card.tag || '').trim(),
          sourceRepair?.repairedCitation || card.citation
        )
      : '',
    reasoning: (review?.correctedReasoning || card.reasoning || '').trim(),
    citation: sourceRepair?.repairedCitation || card.citation,
    bodyHtml: sourceRepair?.repairedBodyHtml || card.bodyHtml,
    sourceTitle: sourceRepair?.sourceBlock.title || card.sourceTitle,
    sourceUrl: sourceRepair?.sourceBlock.url || card.sourceUrl,
    author: sourceRepair?.sourceBlock.author || card.author,
    authorQualifications: sourceRepair?.sourceBlock.authorQualifications || card.authorQualifications,
  };
}

function buildRejectedCandidateNote(
  card: GeneratedCard,
  target: GenerationTarget | undefined,
  review: ReviewCardResult | undefined,
  sourceRepair: SourceRepair | null | undefined
): string {
  if (!target) {
    return 'Rejected: the candidate did not map back to a valid target.';
  }

  if (!sourceRepair) {
    return 'Rejected: no matching source evidence block could be rebuilt from the scraped article text.';
  }

  if (!hasMarkTag(card.bodyHtml)) {
    return 'Rejected: the candidate was missing a highlighted warrant.';
  }

  if (!isCardTypeCompatible(card, target, review)) {
    return 'Rejected: the card type did not match the target side.';
  }

  if (!isEvidenceDirectionCompatible(card, target)) {
    return 'Rejected: the model labeled the evidence as pointing the wrong direction.';
  }

  if (review?.decision === 'REJECT') {
    return review.rejectionReason
      ? `Rejected by QA: ${review.rejectionReason}`
      : 'Rejected by QA review.';
  }

  if (isReviewExplicitlyWrongSide(review, getTargetRule(target).expectedReviewRelation)) {
    return 'Rejected: the evidence pointed toward the wrong side of the target.';
  }

  if (review?.scope === 'TANGENTIAL') {
    return 'Rejected: the evidence was tangential to the contention.';
  }

  if (review?.scope === 'UNCLEAR') {
    return 'Rejected: QA could not confirm that the evidence was materially usable for this target.';
  }

  return 'Rejected: the candidate did not survive materiality validation.';
}

async function scrapeArticleText(
  url: string,
  title: string = '',
  focusTerms: string[] = [],
  readFullPage = false
): Promise<{
  text: string;
  title: string;
  domain: string;
  author?: string;
  authorQualifications?: string;
  publishedDate?: string;
  siteName?: string;
}> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) {
      return { text: '', title, domain: extractDomain(url) };
    }
    const html = await res.text();
    const $ = cheerio.load(html);

    const pageTitle =
      cleanMetadataValue($('meta[property="og:title"]').attr('content')) ||
      cleanMetadataValue($('title').text()) ||
      title;
    const author =
      cleanMetadataValue($('meta[name="author"]').attr('content')) ||
      cleanMetadataValue($('meta[property="article:author"]').attr('content')) ||
      cleanMetadataValue($('meta[name="parsely-author"]').attr('content')) ||
      cleanMetadataValue($('meta[name="dc.creator"]').attr('content'));
    const authorQualifications = extractAuthorQualifications($, author);
    const publishedDate =
      cleanMetadataValue($('meta[property="article:published_time"]').attr('content')) ||
      cleanMetadataValue($('meta[name="pubdate"]').attr('content')) ||
      cleanMetadataValue($('meta[name="parsely-pub-date"]').attr('content')) ||
      cleanMetadataValue($('time').first().attr('datetime'));
    const domain = extractDomain(url);
    const siteName =
      cleanMetadataValue($('meta[property="og:site_name"]').attr('content')) ||
      cleanMetadataValue($('meta[name="application-name"]').attr('content')) ||
      domain;
    $('script, style, noscript, nav, header, footer, aside, .sidebar, .ad').remove();

    const paragraphs: string[] = [];
    $('p').each((_, el) => {
      const paragraph = $(el).text().replace(/\s+/g, ' ').trim();
      if (paragraph) {
        paragraphs.push(paragraph);
      }
    });

    const fullPageText = paragraphs.join('\n\n').trim();
    const excerpt = readFullPage
      ? fullPageText
      : buildRelevantExcerpt(paragraphs, focusTerms);

    return {
      text: excerpt,
      title: pageTitle.trim(),
      domain,
      author,
      authorQualifications,
      publishedDate,
      siteName,
    };
  } catch {
    return { text: '', title, domain: extractDomain(url) };
  }
}

async function parseJsonObject(content: string): Promise<Record<string, unknown>> {
  const parsed = JSON.parse(content) as Record<string, unknown>;
  if (parsed.cards !== undefined || parsed.reviews !== undefined) {
    return parsed;
  }

  const fencedMatch = content.match(/```json\s*([\s\S]*?)\s*```/i);
  if (fencedMatch) {
    return JSON.parse(fencedMatch[1]) as Record<string, unknown>;
  }

  return parsed;
}

async function reviewGeneratedCards(
  apiKeys: string[],
  cards: GeneratedCard[],
  targets: GenerationTarget[],
  preferredApiKey?: string,
  includeTagLine = true,
  aiOptions?: {
    providerMode?: 'cloud' | 'local' | 'auto';
    providerType?: AiProviderType;
    apiKey?: string;
    baseUrl?: string;
    model?: string;
    density?: 'tech' | 'lay';
    localBaseUrl?: string;
    localModel?: string;
    localApiKey?: string;
  }
): Promise<Map<string, ReviewCardResult>> {
  if (cards.length === 0) {
    return new Map();
  }

  const targetMap = new Map(targets.map((target) => [target.id, target]));
  const reviewPayload = cards
    .map((card) => {
      const target = targetMap.get(card.targetId);
      if (!target) {
        return null;
      }

      const rule = getTargetRule(target);

      return {
        id: card.id,
        targetId: card.targetId,
        targetText: target.text,
        targetMode: target.mode,
        targetSide: target.side,
        uniqueness: target.uniqueness,
        link: target.link,
        impact: target.impact,
        expectedRelation: rule.expectedReviewRelation,
        allowedTypePrefixes: rule.allowedTypes,
        tag: card.tag,
        type: card.type,
        reasoning: card.reasoning,
        highlightedQuote: extractMarkedText(card.bodyHtml),
        fullEvidenceText: normalizeWhitespace(stripHtml(card.bodyHtml)).slice(0, 2500),
        wholeTargetTest: rule.wholeTargetTest,
        antiDriftWarning: rule.antiDriftWarning,
      };
    })
    .filter(Boolean);

  if (reviewPayload.length === 0) {
    return new Map();
  }

  const reviewSystemPrompt = `You are a hostile QA editor for debate cards.
Your job is to reject weak cards. A card survives only if the QUOTED evidence itself clearly supports or refutes the target, either directly or by materially answering a central warrant, mechanism, or impact claim that would actually be usable in debate.

For Attack targets, valid refutation patterns include:
- non-uniqueness or status quo already solving the harm
- no-solvency or no-link evidence showing the contention will not fix the problem
- alternative cause or alternative actor solves better
- turns or backfire evidence showing the contention worsens the problem
If the target includes uniqueness, link, and impact fields, judge the evidence against that structured chain.
Do NOT reject a card merely because the quote does not literally restate the target outcome if it still provides one of those usable takeouts.

For Defend targets (targetMode === "Defend"), valid defensive frontline patterns include:
- re-establishing uniqueness against a non-uniqueness challenge (e.g. the problem still exists, the status quo is not solving)
- defending the link or mechanism against objections (e.g. the plan still links, circumvention is not possible)
- answering turns or backlash claims (e.g. the feared harm does not occur, the backlash argument is empirically denied)
- proving solvency despite challenges (e.g. the mechanism works as claimed, past examples confirm effectiveness)
- showing no internal link to a disadvantage or turn impact
Do NOT reject Defend cards merely because they also support the original contention generally — as long as the evidence addresses how the contention survives a plausible challenge, KEEP it.

Definitions:
- WHOLE_TARGET: A judge reading only the highlighted quote would reasonably conclude the whole target statement is proven or refuted overall.
- PARTIAL: The quote does not settle the whole target by itself, but it materially answers an important warrant, mechanism, internal link, solvency claim, impact, non-uniqueness claim, alternative-cause claim, or turn in a way that would still be usable in a speech.
- TANGENTIAL: The quote is about an adjacent topic and does not directly answer the target.

Tag standard:
${includeTagLine
  ? '- The tag must say only what the quoted evidence says.\n- If the tag overclaims, narrows incorrectly, or adds a causal step the quote does not provide, mark it OVERCLAIMED or MISALIGNED.\n- You may repair a tag or reasoning sentence, but only KEEP the card if the underlying evidence-target relationship is still strong and materially usable.'
  : '- The tag field may be intentionally blank to save tokens. Do not reject a card merely because its tag is empty.\n- Focus review on whether the evidence itself materially supports or refutes the target and whether the reasoning is faithful to the quote.'}

Output JSON only:
{
  "reviews": [
    {
      "id": "card id",
      "decision": "KEEP or REJECT",
      "relation": "SUPPORTS_TARGET or REFUTES_TARGET or TANGENTIAL or UNCLEAR",
      "scope": "WHOLE_TARGET or PARTIAL or TANGENTIAL or UNCLEAR",
      "tagAccuracy": "ACCURATE or OVERCLAIMED or MISALIGNED or UNCLEAR",
      "correctedTag": "short corrected tag if useful, otherwise empty string",
      "correctedReasoning": "short corrected reasoning if useful, otherwise empty string",
      "correctedType": "AFF or NEG or NQ or NL or DL or T if useful, otherwise empty string",
      "rejectionReason": "brief reason"
    }
  ]
}`;

  try {
    const orderedApiKeys = prioritizeApiKey(apiKeys, preferredApiKey);
    const { response } = await createCompletionWithKeyRotation(
      orderedApiKeys,
      {
        model: aiOptions?.model?.trim() || 'openai/gpt-oss-120b',
        messages: [
          { role: 'system', content: reviewSystemPrompt },
          { role: 'user', content: JSON.stringify({ cards: reviewPayload }) },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1,
        max_tokens: 1200,
      },
      aiOptions
    );

    const content = response.choices[0]?.message?.content;
    if (!content) {
      return new Map();
    }

    const parsed = await parseJsonObject(content);
    const reviews = Array.isArray(parsed.reviews) ? parsed.reviews : [];

    return new Map(
      reviews
        .filter((review): review is ReviewCardResult => Boolean(review && typeof review === 'object' && 'id' in review))
        .map((review) => [review.id, review])
    );
  } catch (error) {
    console.error('Card review pass failed, falling back to local validation only.', error);
    return new Map();
  }
}

export async function POST(req: Request) {
  try {
    const {
      topic,
      targets,
      articles,
      feedback,
      preScrapedText,
      singleTitle,
      groqApiKeys,
      groqApiKeyRotationOffset,
      includeTagLine,
      groqApiKey,
      apiKey,
      baseUrl,
      model,
      providerType,
      density,
      fullPageCut = true,
      providerMode,
      localBaseUrl,
      localModel,
      localApiKey,
    }: {
      topic?: string;
      targets?: GenerationTarget[];
      articles?: Array<{ url: string; title: string }>;
      feedback?: string;
      preScrapedText?: string;
      singleTitle?: string;
      groqApiKeys?: string[];
      groqApiKeyRotationOffset?: number;
      includeTagLine?: boolean;
      groqApiKey?: string;
      apiKey?: string;
      baseUrl?: string;
      model?: string;
      providerType?: AiProviderType;
      density?: 'tech' | 'lay';
      fullPageCut?: boolean;
      providerMode?: 'cloud' | 'local' | 'auto';
      localBaseUrl?: string;
      localModel?: string;
      localApiKey?: string;
    } = await req.json();

    if (!topic || !targets || !Array.isArray(targets) || targets.length === 0) {
      return NextResponse.json({ error: 'Missing required fields or empty targets' }, { status: 400 });
    }

    const sourceBlocks: SourceBlock[] = [];
    const focusTerms = extractFocusTerms(targets);

    if (preScrapedText) {
      const cleanedText = preScrapedText.trim();
      if (cleanedText.length > 200) {
        sourceBlocks.push({
          id: 'SOURCE_1',
          title: singleTitle || 'Custom Source',
          url: 'Custom URL',
          text: cleanedText,
          normalizedText: normalizeWhitespace(cleanedText),
          paragraphs: splitIntoParagraphs(cleanedText),
          domain: 'custom-source',
          siteName: 'Custom Source',
        });
      }
    } else if (articles && Array.isArray(articles)) {
      const allowedArticles = articles.filter((item) => {
        if (!isBannedUrl(item.url)) return true;
        console.log(`Skipping banned source during generation: ${item.url}`);
        return false;
      });
      // The focused contention finder supplies a small source batch. These
      // page reads do not depend on one another, so fetch them concurrently
      // rather than making the user wait for one site before trying the next.
      const scrapedArticles = await Promise.all(
        allowedArticles.map(async (item) => {
          console.log(`Scraping for generation: ${item.url}`);
          return {
            item,
            articleData: await scrapeArticleText(item.url, item.title, focusTerms, fullPageCut),
          };
        })
      );

      for (const { item, articleData } of scrapedArticles) {
        if (articleData.text.length > 200) {
          sourceBlocks.push({
            id: `ARTICLE_${sourceBlocks.length + 1}`,
            title: articleData.title,
            url: item.url,
            text: articleData.text,
            normalizedText: normalizeWhitespace(articleData.text),
            paragraphs: splitIntoParagraphs(articleData.text),
            domain: articleData.domain,
            author: articleData.author,
            publishedDate: articleData.publishedDate,
            siteName: articleData.siteName,
          });
        }
      }
    }

    const promptChunks = fullPageCut && !preScrapedText
      ? buildFullPagePromptChunks(sourceBlocks)
      : sourceBlocks.map((sourceBlock) => ({
          sourceBlock,
          text: sourceBlock.text,
          chunkNumber: 1,
          chunkCount: 1,
        }));
    if (promptChunks.length === 0 || promptChunks.every((chunk) => chunk.text.length < 250)) {
      return NextResponse.json({ cards: [] });
    }

    const normalizedSourceContext = normalizeWhitespace(
      sourceBlocks.map((sourceBlock) => sourceBlock.text).join('\n\n')
    );
    const availableApiKeys = rotateApiKeys(
      normalizeGroqApiKeys(groqApiKeys, groqApiKey, apiKey),
      groqApiKeyRotationOffset ?? 0
    );
    const aiOptions = {
      providerMode,
      providerType,
      apiKey: apiKey?.trim() || (availableApiKeys.length > 0 ? availableApiKeys[0] : undefined),
      baseUrl,
      model,
      density,
      localBaseUrl,
      localModel,
      localApiKey,
    };
    const shouldIncludeTagLine = includeTagLine !== false;

    const targetListText = targets.map((target) => buildTargetConstraint(target)).join('\n\n');
    const feedbackInjection = feedback
      ? `\nCRITICAL USER FEEDBACK: "${feedback}". Adapt selection strategy to follow this exactly without violating evidence fidelity.`
      : '';
    const tagLineInstruction = shouldIncludeTagLine
      ? "7. The tag must be faithful to the highlighted quote. No extra impacts, no added mechanisms, no bigger conclusion than the quote supports."
      : "7. Do NOT spend output tokens on a tag line. Set the `tag` field to an empty string and focus entirely on evidence, citation, type, and reasoning.";
    const tagFieldInstruction = shouldIncludeTagLine
      ? '"tag": "TYPE) short faithful tag that matches the highlighted evidence",'
      : '"tag": "",';

    const systemPrompt = `You are a strict Debate Evidence Extraction Engine.
You must ONLY use the ACTUAL SOURCED CONTEXT below. Never invent evidence, never blend multiple articles into one quote, and never write a tag that says more than the highlighted quote proves.

ACTIVE TARGETS:
${targetListText}
${feedbackInjection}

NON-NEGOTIABLE RULES:
1. bodyHtml must be copied verbatim from one source text block only. No paraphrase inside bodyHtml.
2. The highlighted <mark> text is the exact warrant that proves the card's tag.
3. For Attack targets, NEVER output evidence that merely discusses a side issue or one tiny stray premise. The evidence may refute the contention as a whole or materially undercut a central warrant, solvency claim, internal link, impact, non-uniqueness claim, alternative cause, or by showing the contention turns the case.
   For Defend targets, output defensive frontline evidence that protects the contention against responses, turns, or takeout arguments (e.g. defending solvency against skepticism, proving link mechanism holds despite obstacles, disproving backlash/turns, or re-establishing uniqueness).
4. When a target includes a Contention Chain, use Uniqueness as the status quo claim, Link as the mechanism/solvency claim, and Impact as the changed outcome. For Attack targets, prefer cards that directly attack one of those chain links or turn the chain. For Defend targets, prefer cards that defend and fortify those specific links against anticipated attacks.
5. For Attack targets: If a quote could still reasonably be used by the same side as the target, reject it internally and do not output a card. For Defend targets: Evidence must support and defend the target's side against opponent refutations.
6. For every card from a structured Contention Chain, classify the evidence with the contentionField field: use UNIQUENESS for current conditions, status quo facts, existing trends, or the present problem; LINK for the mechanism, plan effect, solvency, or causal connection; and IMPACT for downstream consequences, harms, benefits, or outcomes. Do not label every card as LINK just because the evidence is a warrant.
7. Impact-selection priority: when multiple usable cards support or refute the impact, always choose the strongest and largest-scale impact evidence available. Prefer concrete numbers, percentages, totals, affected-population counts, mortality, dollars, time effects, or other measured outcomes over vague qualitative descriptions. Among credible quantified options, prefer the larger material magnitude and clearer causal connection, while staying faithful to the source and never inflating or comparing unlike measurements.
   If the Impact says an outcome is stopped, prevented, avoided, averted, reduced, or mitigated (for example, "the US-China arms race is stopped"), do not stop at evidence that the outcome was prevented. Prefer evidence explaining the negative consequences of that underlying outcome if it occurred—such as conflict, deaths, economic costs, escalation, displacement, or other measurable harms—so the card proves why preventing it matters. Use the strongest quantified downstream harm available.
${tagLineInstruction}
9. Do not default to an empty response. When a source materially addresses any requested uniqueness, link, or impact claim, output the strongest source-grounded card for that claim even if it proves a central part rather than every word of the target. Output nothing only when none of the supplied sources materially addresses the target at all.
10. For Attack targets, acceptable cards include: "status quo already improving this," "the proposal does not solve this harm," "another actor solves better," and "this makes the harm worse." For Defend targets, acceptable cards include: "status quo is definitely not solving," "objections/backlash are empirically unfounded," "solvency holds and works effectively," and "mechanism cannot be circumvented." These still count even when the quote does not literally restate the target's final impact language.
11. In whole-page mode, this request contains one section of a larger page. Return every distinct, materially usable card from this section (up to 2), not just the first matching sentence. Different sections will be processed separately.
12. Never place citation lines, URLs, bylines, dates, or article metadata inside bodyHtml.

FORMATTING RULES:
1. Copy a complete, useful verbatim evidence passage from the source text. Do not omit the warrant, data, qualifier, or logical step needed to understand it.
2. Wrap a complete, read-aloud warrant block in <mark>...</mark>—normally 2–4 connected sentences containing the actor, action, data, qualifier, causal relationship, and result. A lone keyword, number, name, short fragment, or single bare conclusion is never enough. Keep the marked span focused (usually 20–180 words) rather than highlighting the entire article.
3. Wrap only the minimum surrounding context needed to make the highlighted evidence understandable in <u>...</u>. Keep <u> outside <mark>; never underline the read-aloud highlight itself. Leave ordinary supporting text unwrapped.
4. Inside each <mark>, use <strong>...</strong> for exactly one consequential word per sentence and do not bold any other words.

CITATION RULE:
1. citation must refer to the same single source block as bodyHtml.
2. Do not invent author qualifications, dates, or URLs that are not clearly present.
3. If you are unsure, keep citation minimal. The server will normalize the final citation.

Respond ONLY with JSON:
{
  "cards": [
    {
      "targetId": "exact target id",
      "evidenceDirection": "PROVES_TARGET_TRUE or PROVES_TARGET_FALSE or IRRELEVANT",
      "id": "unique string",
      "reasoning": "1-2 sentences explaining how the highlighted quote proves or refutes the whole target",
      "contentionField": "UNIQUENESS or LINK or IMPACT",
      ${tagFieldInstruction}
      "citation": "short source note for the same article",
      "bodyHtml": "large verbatim quote block with <u> and <mark>",
      "type": "AFF or NEG or NQ or NL or DL or T"
    }
  ]
}`;

    const generatedCandidates: GeneratedCard[] = [];
    let usedApiKey = availableApiKeys[0];
    let partialPageCut = false;

    for (let chunkIndex = 0; chunkIndex < promptChunks.length; chunkIndex += 1) {
      const promptChunk = promptChunks[chunkIndex];
      const userPrompt = `Topic: ${topic}

This is website section ${promptChunk.chunkNumber} of ${promptChunk.chunkCount} from ${promptChunk.sourceBlock.title}. Return every distinct candidate card materially supported by this section (up to 2). Prefer a narrow, faithful card over an empty cards array; the server will independently verify every candidate.

--- ACTUAL SOURCED CONTEXT TO USE ---
${buildPromptSourceContext([{ ...promptChunk.sourceBlock, text: promptChunk.text }])}`;

      try {
        const requestMessages = [
          { role: 'system' as const, content: systemPrompt },
          { role: 'user' as const, content: userPrompt },
        ];
        let completionResult: { response: ChatCompletionResponse; usedApiKey: string };
        try {
          completionResult = await createCompletionWithKeyRotation(
            rotateApiKeys(availableApiKeys, chunkIndex),
            {
              model: aiOptions.model?.trim() || 'openai/gpt-oss-120b',
              messages: requestMessages,
              response_format: { type: 'json_object' },
              temperature: 0.2,
              max_tokens: fullPageCut ? 900 : 2000,
            },
            aiOptions
          );
        } catch (firstError) {
          const firstMessage = firstError instanceof Error ? firstError.message.toLowerCase() : '';
          const firstStatus = firstError instanceof Error && 'status' in firstError && typeof firstError.status === 'number'
            ? firstError.status
            : undefined;
          if (firstStatus !== 400 || !firstMessage.includes('failed_generation')) {
            throw firstError;
          }

          // Groq can reject JSON mode on a complex long prompt even when the
          // content is valid. Retry the same section with a compact JSON-only
          // instruction and let the server parser validate the result.
          completionResult = await createCompletionWithKeyRotation(
            rotateApiKeys(availableApiKeys, chunkIndex),
            {
              model: aiOptions.model?.trim() || 'openai/gpt-oss-120b',
              messages: [
                {
                  role: 'system',
                  content: 'Return valid JSON only. Use exactly this shape: {"cards":[]}. Put source-verbatim cards in the cards array. No markdown, no explanation.',
                },
                { role: 'user', content: `${userPrompt}\nReturn valid JSON only.` },
              ],
              temperature: 0.1,
              max_tokens: fullPageCut ? 700 : 1500,
            },
            aiOptions
          );
        }
        const { response, usedApiKey: chunkApiKey } = completionResult;
        usedApiKey = chunkApiKey;
        const content = response.choices[0]?.message?.content;
        if (!content) {
          continue;
        }

        let parsed = await parseJsonObject(content);
        let sectionCards = Array.isArray(parsed.cards) ? parsed.cards as GeneratedCard[] : [];

        // Some provider/model combinations answer the long validation prompt
        // with an empty array even when the section contains usable evidence.
        // Give that section one compact, source-verbatim rescue attempt before
        // moving on, instead of silently counting it as a scanned miss.
        if (sectionCards.length === 0) {
          const rescueTarget = targets[0];
          const rescueRule = rescueTarget ? getTargetRule(rescueTarget) : null;
          const rescueResult = await createCompletionWithKeyRotation(
            rotateApiKeys(availableApiKeys, chunkIndex + 1),
            {
              model: aiOptions.model?.trim() || 'openai/gpt-oss-120b',
              messages: [
                {
                  role: 'system',
                  content: `Return JSON only: {"cards":[{"targetId":"${rescueTarget?.id || ''}","evidenceDirection":"${rescueRule?.expectedEvidenceDirection || 'PROVES_TARGET_FALSE'}","id":"rescue_${chunkIndex}","reasoning":"why this source materially supports or refutes the target","contentionField":"LINK","tag":"short faithful debate tag","citation":"source note","bodyHtml":"verbatim source text with <mark> around the strongest 1-3 sentence warrant and <u> only around needed context","type":"${rescueRule?.allowedTypes[0] || 'NEG'}"}]}. If this section has no material evidence, return {"cards":[]}. Never invent wording.`,
                },
                { role: 'user', content: userPrompt },
              ],
              response_format: { type: 'json_object' },
              temperature: 0.1,
              max_tokens: 900,
            },
            aiOptions
          );
          const rescueContent = rescueResult.response.choices[0]?.message?.content;
          if (rescueContent) {
            parsed = await parseJsonObject(rescueContent);
            sectionCards = Array.isArray(parsed.cards) ? parsed.cards as GeneratedCard[] : [];
          }
        }
        generatedCandidates.push(...sectionCards);
      } catch (error) {
        const status =
          error instanceof Error && 'status' in error && typeof error.status === 'number'
            ? error.status
            : undefined;
        if ((status === 429 || status === 413) && generatedCandidates.length > 0) {
          partialPageCut = true;
          console.warn(`Whole-page cutting stopped after section ${chunkIndex} because the provider is currently limited.`);
          break;
        }
        throw error;
      }
    }

    const rawCards = ensureUniqueGeneratedCardIds(generatedCandidates);
    const targetMap = new Map(targets.map((target) => [target.id, target]));
    const sourceRepairs = new Map(rawCards.map((card) => [card.id, repairCardAgainstSource(card, sourceBlocks)]));
    const repairedCards = rawCards.flatMap((card) => {
      const sourceRepair = sourceRepairs.get(card.id);
      if (!sourceRepair) {
        return [];
      }

      return [
        {
          ...card,
          bodyHtml: sourceRepair.repairedBodyHtml,
          citation: sourceRepair.repairedCitation,
          sourceTitle: sourceRepair.sourceBlock.title,
          sourceUrl: sourceRepair.sourceBlock.url,
          author: sourceRepair.sourceBlock.author,
          authorQualifications: sourceRepair.sourceBlock.authorQualifications,
        },
      ];
    });
    const reviewResults = await reviewGeneratedCards(
      availableApiKeys,
      repairedCards,
      targets,
      usedApiKey,
      shouldIncludeTagLine,
      aiOptions
    );

    const strictValidatedCards = repairedCards.flatMap((card) => {
      if (!card?.targetId || !card.id || !card.bodyHtml || !hasMarkTag(card.bodyHtml)) {
        return [];
      }

      const matchedTarget = targetMap.get(card.targetId);
      if (!matchedTarget) {
        return [];
      }

      const rule = getTargetRule(matchedTarget);
      if (!isCardTypeCompatible(card, matchedTarget) || !isEvidenceDirectionCompatible(card, matchedTarget)) {
        return [];
      }

      if (!isCardBodyVerbatimFromSource(card.bodyHtml, normalizedSourceContext)) {
        return [];
      }

      const review = reviewResults.get(card.id);
      if (review) {
        if (review.decision !== 'KEEP') {
          return [];
        }

        if (review.relation !== rule.expectedReviewRelation) {
          return [];
        }

        if (review.scope !== 'WHOLE_TARGET') {
          return [];
        }
      }

      const normalizedCard = normalizeCardAfterReview(card, matchedTarget, review, shouldIncludeTagLine);
      if (!normalizedCard) {
        return [];
      }

      return [
        {
          ...normalizedCard,
          contention: buildTargetContentionLabel(matchedTarget),
        },
      ];
    });

    const fallbackValidatedCards = repairedCards.flatMap((card) => {
      if (!card?.targetId || !card.id || !card.bodyHtml || !hasMarkTag(card.bodyHtml)) {
        return [];
      }

      const matchedTarget = targetMap.get(card.targetId);
      if (!matchedTarget) {
        return [];
      }

      const rule = getTargetRule(matchedTarget);
      const review = reviewResults.get(card.id);
      if (!review) {
        return [];
      }

      if (!isCardTypeCompatible(card, matchedTarget, reviewResults.get(card.id))) {
        return [];
      }

      if (!isEvidenceDirectionCompatible(card, matchedTarget)) {
        return [];
      }

      if (review.decision !== 'KEEP') {
        return [];
      }

      if (review.relation !== rule.expectedReviewRelation) {
        return [];
      }

      if (review.scope !== 'WHOLE_TARGET' && review.scope !== 'PARTIAL') {
        return [];
      }

      const normalizedCard = normalizeCardAfterReview(card, matchedTarget, review, shouldIncludeTagLine);
      if (!normalizedCard) {
        return [];
      }

      return [
        {
          ...normalizedCard,
          contention: buildTargetContentionLabel(matchedTarget),
        },
      ];
    });

    const rescueValidatedCards =
      strictValidatedCards.length === 0 && fallbackValidatedCards.length === 0
        ? repairedCards.flatMap((card) => {
            if (!card?.targetId || !card.id || !card.bodyHtml || !hasMarkTag(card.bodyHtml)) {
              return [];
            }

            const matchedTarget = targetMap.get(card.targetId);
            if (!matchedTarget) {
              return [];
            }

            const review = reviewResults.get(card.id);
            if (!review) {
              return [];
            }

            const rule = getTargetRule(matchedTarget);
            if (review.relation !== rule.expectedReviewRelation) {
              return [];
            }

            if (review.scope !== 'WHOLE_TARGET' && review.scope !== 'PARTIAL') {
              return [];
            }

            if (!isCardTypeCompatible(card, matchedTarget, review)) {
              return [];
            }

            if (!isEvidenceDirectionCompatible(card, matchedTarget)) {
              return [];
            }

            if (review.decision !== 'KEEP') {
              return [];
            }

            const normalizedCard = normalizeCardAfterReview(
              card,
              matchedTarget,
              review,
              shouldIncludeTagLine
            );
            if (!normalizedCard) {
              return [];
            }

            return [
              {
                ...normalizedCard,
                contention: buildTargetContentionLabel(matchedTarget),
              },
            ];
          })
        : [];

    const finalCards = mergeValidatedCards(
      strictValidatedCards,
      fallbackValidatedCards,
      rescueValidatedCards
    );
    const strictCardIds = new Set(strictValidatedCards.map((card) => card.id));
    const fallbackCardIds = new Set(fallbackValidatedCards.map((card) => card.id));
    const rescueCardIds = new Set(rescueValidatedCards.map((card) => card.id));
    const candidateCards: CandidateCardPayload[] = rawCards.map((card) => {
      const target = targetMap.get(card.targetId);
      const review = reviewResults.get(card.id);
      const sourceRepair = sourceRepairs.get(card.id);
      const displayCard = buildCandidateDisplayCard(
        card,
        target,
        review,
        shouldIncludeTagLine,
        sourceRepair
      );
      const validationStage: CandidateStage = strictCardIds.has(card.id)
        ? 'strict'
        : fallbackCardIds.has(card.id)
          ? 'fallback'
          : rescueCardIds.has(card.id)
            ? 'rescue'
            : 'rejected';

      return {
        ...displayCard,
        contention: target ? buildTargetContentionLabel(target) : 'Unknown target',
        status: validationStage === 'rejected' ? 'rejected' : 'accepted',
        validationStage,
        note:
          validationStage === 'strict'
            ? 'Accepted after strict source-verbatim and whole-target validation.'
            : validationStage === 'fallback'
              ? 'Accepted after repaired-source fallback validation.'
              : validationStage === 'rescue'
                ? 'Accepted by the rescue pass after stricter checks found nothing usable.'
                : buildRejectedCandidateNote(card, target, review, sourceRepair),
      };
    });

    console.log(
      `Generation returned ${rawCards.length} raw cards, ${strictValidatedCards.length} strict cards, ${fallbackValidatedCards.length} fallback cards, ${rescueValidatedCards.length} rescue cards.`
    );

    return NextResponse.json({
      cards: finalCards,
      candidates: candidateCards,
      notice: partialPageCut
        ? 'Whole-page cutting paused after the provider reached its current usage limit; the cards found so far were returned.'
        : undefined,
      debug: {
        rawCards: rawCards.length,
        strictCards: strictValidatedCards.length,
        fallbackCards: fallbackValidatedCards.length,
        rescueCards: rescueValidatedCards.length,
        sourceChunks: promptChunks.length,
        partialPageCut,
      },
    });
  } catch (err: unknown) {
    console.error(err);
    const message = err instanceof Error ? err.message : 'Unknown error occurred.';
    const status =
      err instanceof Error && 'status' in err && typeof err.status === 'number' ? err.status : 500;
    const code =
      err instanceof Error && 'code' in err && typeof err.code === 'string' ? err.code : undefined;
    return NextResponse.json({ error: message, code }, { status });
  }
}
