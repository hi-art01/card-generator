'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Card, CardData, CardQualityRating } from './Card';
import { Navbar, TabId } from './Navbar';
import { CardDepositoriesTab } from './CardDepositoriesTab';
import { ContradictionFinderTab } from './ContradictionFinderTab';
import { OpponentCaseCounterTab } from './OpponentCaseCounterTab';
import { CardRankerTab } from './CardRankerTab';
import { ContentionEvidenceTab } from './ContentionEvidenceTab';
import { RheotriciserTab } from './RheotriciserTab';
import { TopicCardCutterTab } from './TopicCardCutterTab';
import { AiEngineSelector } from './AiEngineSelector';
import { AutoCarderTab } from './AutoCarderTab';
import { BloxTab } from './BloxTab';
import { BatchCutterTab } from './BatchCutterTab';
import { CardLibraryTab } from './CardLibraryTab';
import { getAiConfigFromStorage, AiProviderType } from '../lib/aiProvider';

type TargetSide = 'Affirmative' | 'Negative' | 'Support';
type TargetMode = 'Attack' | 'Support' | 'Defend';
type ContentionStructuredField = 'uniqueness' | 'link' | 'impact';
type ContentionField = ContentionStructuredField | 'paragraph';
type ContentionSidePrefix = 'aff' | 'neg';
type RebuttalSideMode = 'both' | 'aff' | 'neg';
type ContentionPrepMode = 'attack' | 'defense';
type ContentionFormat = 'structured' | 'paragraph';

interface GenerationTarget {
  text: string;
  side: TargetSide;
  mode: TargetMode;
  uniqueness?: string;
  link?: string;
  impact?: string;
}

interface HydratedTarget extends GenerationTarget {
  id: string;
  cardsNeeded: number;
  contention: string;
  feedback?: string;
}

interface SearchArticle {
  url: string;
  title: string;
}

interface DeepCutChunk {
  textChunk: string;
  title: string;
}

type ArticlePoolItem = SearchArticle | DeepCutChunk;

interface GenerateRequestBody {
  topic: string;
  targets: HydratedTarget[];
  feedback: string;
  articles?: SearchArticle[];
  preScrapedText?: string;
  singleTitle?: string;
  groqApiKeys?: string[];
  groqApiKeyRotationOffset?: number;
  includeTagLine: boolean;
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

interface GeneratedApiCard extends CardData {
  targetId: string;
}

type CandidateStatus = 'accepted' | 'rejected';
type CandidateStage = 'strict' | 'fallback' | 'rescue' | 'rejected';

interface CandidateApiCard extends CardData {
  targetId: string;
  status: CandidateStatus;
  validationStage: CandidateStage;
  note: string;
}

interface RenderedCard extends GeneratedApiCard {
  _rawTarget: HydratedTarget;
  _runSignature: string;
}

interface RenderedCandidateCard extends CandidateApiCard {
  _rawTarget: HydratedTarget | null;
  _runSignature: string;
}

interface GenerateResponse {
  cards?: GeneratedApiCard[];
  candidates?: CandidateApiCard[];
  error?: string;
  code?: string;
  debug?: {
    rawCards: number;
    strictCards: number;
    fallbackCards: number;
    rescueCards: number;
  };
}

interface SearchResponse {
  results?: SearchArticle[];
  error?: string;
  exhausted?: boolean;
  nextRound?: number;
  queriesUsed?: string[];
  providerUnavailable?: boolean;
  providerErrors?: string[];
}

interface SearchRoundOutcome {
  searchData: SearchResponse | null;
  results: SearchArticle[];
  nextRound: number;
  attemptsWithoutResults: number;
  providerUnavailable: boolean;
  providerUnavailableRounds: number;
}

interface ScrapeResponse {
  text?: string;
  title?: string;
  error?: string;
}

interface TaglineResponse {
  tag?: string;
  error?: string;
  code?: string;
}

interface RankingResponse {
  rating?: CardQualityRating;
  error?: string;
  code?: string;
}

interface ScreenWakeLockSentinel {
  released?: boolean;
  release: () => Promise<void>;
  addEventListener?: (type: 'release', listener: () => void) => void;
}

type WakeLockCapableNavigator = Navigator & {
  wakeLock?: {
    request: (type: 'screen') => Promise<ScreenWakeLockSentinel>;
  };
};

interface GroupedCardsEntry {
  cards: RenderedCard[];
  target: HydratedTarget | null;
}

interface GroupedCandidateEntry {
  cards: RenderedCandidateCard[];
  target: HydratedTarget | null;
}

interface HuntSummary {
  batchesScanned: number;
  sourcesScanned: number;
  acceptedCards: number;
  rawCards: number;
  strictCards: number;
  fallbackCards: number;
  rescueCards: number;
}

interface CheckedSiteStats {
  totalSites: number;
  matchingSites: number;
  trackedContentions: number;
}

interface ZipSourceFile {
  path: string;
  content: string;
}

interface ZipCentralDirectoryEntry {
  filenameBytes: Uint8Array;
  crc32: number;
  compressedSize: number;
  uncompressedSize: number;
  offset: number;
  dosTime: number;
  dosDate: number;
}

interface ContentionInput {
  id: string;
  uniqueness: string;
  link: string;
  impact: string;
  paragraph?: string;
}

interface ContentionEditorProps {
  title: string;
  accentColor: string;
  borderColor: string;
  contentions: ContentionInput[];
  format: ContentionFormat;
  disabled: boolean;
  onAdd: () => void;
  onRemove: (id: string) => void;
  onUpdate: (id: string, field: ContentionField, value: string) => void;
}

const FORM_STORAGE_KEYS = {
  topic: 'debate_form_topic',
  affContentions: 'debate_form_aff_contentions',
  negContentions: 'debate_form_neg_contentions',
  rebuttalSideMode: 'debate_form_rebuttal_side_mode',
  prepMode: 'debate_form_prep_mode',
  contentionFormat: 'debate_form_contention_format',
  supportResponses: 'debate_form_support_responses',
  targetUrl: 'debate_form_target_url',
  includeTagLine: 'debate_form_include_tag_line',
  cardCount: 'debate_form_card_count',
  findUntilStopped: 'debate_form_find_until_stopped',
} as const;
const CHECKED_SITE_MEMORY_STORAGE_KEY = 'debate_form_checked_sites_v1';
const MAX_CHECKED_SITES_PER_CONTENTION = 500;
const SEARCH_PROGRESS_INTERVAL = 8;
const PROVIDER_RETRY_DELAYS_MS = [800, 1600, 3000, 5000];
const HUNT_STOPPED_ERROR_CODE = 'HUNT_STOPPED';
const ZIP_LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const ZIP_CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const ZIP_UTF8_GENERAL_PURPOSE_FLAG = 0x0800;
const CONTENTION_FIELD_CONFIG: Array<{
  field: ContentionStructuredField;
  label: string;
  placeholder: string;
}> = [
  {
    field: 'uniqueness',
    label: '1. Uniqueness',
    placeholder: 'Status quo claim, e.g. crime is high now',
  },
  {
    field: 'link',
    label: '2. Link',
    placeholder: 'How the case causes change, e.g. cameras deter crime',
  },
  {
    field: 'impact',
    label: '3. Impact',
    placeholder: 'What changes, e.g. less theft saves money',
  },
];

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);

  for (let i = 0; i < table.length; i += 1) {
    let crc = i;

    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }

    table[i] = crc >>> 0;
  }

  return table;
})();

function isDeepCutChunk(item: ArticlePoolItem): item is DeepCutChunk {
  return 'textChunk' in item;
}

function isSearchArticle(item: ArticlePoolItem): item is SearchArticle {
  return 'url' in item;
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

async function getResponseErrorMessage(response: Response, fallback: string): Promise<string> {
  const rawText = await response.text();

  if (!rawText) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(rawText) as { error?: string };
    return parsed.error || fallback;
  } catch {
    return rawText;
  }
}

function getStoredString(key: string, fallback = ''): string {
  if (typeof window === 'undefined') {
    return fallback;
  }

  return window.localStorage.getItem(key) ?? fallback;
}

function getStoredBoolean(key: string, fallback: boolean): boolean {
  if (typeof window === 'undefined') {
    return fallback;
  }

  const value = window.localStorage.getItem(key);
  if (value === null) {
    return fallback;
  }

  return value === 'true';
}

function getStoredNumber(key: string, fallback: number): number {
  if (typeof window === 'undefined') {
    return fallback;
  }

  const value = Number(window.localStorage.getItem(key));
  if (!Number.isFinite(value) || value < 1) {
    return fallback;
  }

  return value;
}

function persistStoredValue(key: string, value: string | number | boolean) {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(key, String(value));
}

function parseTargetUrls(rawValue: string): string[] {
  if (!rawValue) return [];
  const entries = rawValue
    .split(/[\n,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);

  const validUrls: string[] = [];
  for (const entry of entries) {
    const candidate = /^https?:\/\//i.test(entry) ? entry : `https://${entry}`;
    try {
      const parsed = new URL(candidate);
      if (['http:', 'https:'].includes(parsed.protocol) && parsed.hostname.includes('.')) {
        validUrls.push(parsed.href);
      }
    } catch {
      // Skip invalid URLs
    }
  }

  return Array.from(new Set(validUrls));
}

function buildContentionId(idPrefix: ContentionSidePrefix, index: number): string {
  return `${idPrefix}_${index}`;
}

function createContentionInput(
  idPrefix: ContentionSidePrefix,
  index: number,
  values: Partial<Omit<ContentionInput, 'id'>> & { id?: string } = {}
): ContentionInput {
  return {
    id: values.id || buildContentionId(idPrefix, index),
    uniqueness: values.uniqueness || '',
    link: values.link || '',
    impact: values.impact || '',
    paragraph: values.paragraph || '',
  };
}

function createNewContentionInput(idPrefix: ContentionSidePrefix): ContentionInput {
  return createContentionInput(idPrefix, Date.now(), {
    id: `${idPrefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
  });
}

function getContentionFieldValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function hasContentionInputValue(
  contention: ContentionInput,
  format: ContentionFormat = 'structured'
): boolean {
  if (format === 'paragraph') {
    return Boolean(
      (contention.paragraph && contention.paragraph.trim()) ||
      contention.uniqueness.trim() ||
      contention.link.trim() ||
      contention.impact.trim()
    );
  }
  return Boolean(
    contention.uniqueness.trim() ||
    contention.link.trim() ||
    contention.impact.trim() ||
    (contention.paragraph && contention.paragraph.trim())
  );
}

function parseStoredContentions(key: string, idPrefix: ContentionSidePrefix): ContentionInput[] {
  const rawValue = getStoredString(key);
  const trimmedValue = rawValue.trim();

  if (!trimmedValue) {
    return [createContentionInput(idPrefix, 0)];
  }

  try {
    const parsedValue = JSON.parse(trimmedValue) as unknown;

    if (Array.isArray(parsedValue)) {
      const contentions = parsedValue.map((item, index) => {
        if (!item || typeof item !== 'object') {
          return createContentionInput(idPrefix, index);
        }

        const record = item as Record<string, unknown>;
        return createContentionInput(idPrefix, index, {
          id: getContentionFieldValue(record.id) || buildContentionId(idPrefix, index),
          uniqueness: getContentionFieldValue(record.uniqueness),
          link: getContentionFieldValue(record.link),
          impact: getContentionFieldValue(record.impact),
          paragraph: getContentionFieldValue(record.paragraph),
        });
      });

      return contentions.length > 0 ? contentions : [createContentionInput(idPrefix, 0)];
    }
  } catch {
    // Fall through to legacy newline migration below.
  }

  const legacyContentions = rawValue
    .split('\n')
    .map((line, index) =>
      createContentionInput(idPrefix, index, {
        uniqueness: line.trim(),
      })
    )
    .filter((contention) => hasContentionInputValue(contention));

  return legacyContentions.length > 0
    ? legacyContentions
    : [createContentionInput(idPrefix, 0)];
}

function serializeContentionsForStorage(contentions: ContentionInput[]): string {
  return JSON.stringify(
    contentions.map((contention) => ({
      id: contention.id,
      uniqueness: contention.uniqueness,
      link: contention.link,
      impact: contention.impact,
      paragraph: contention.paragraph || '',
    }))
  );
}

function updateContentionInput(
  contentions: ContentionInput[],
  id: string,
  field: ContentionField,
  value: string
): ContentionInput[] {
  return contentions.map((contention) =>
    contention.id === id ? { ...contention, [field]: value } : contention
  );
}

function removeContentionInput(
  contentions: ContentionInput[],
  id: string,
  idPrefix: ContentionSidePrefix
): ContentionInput[] {
  const nextContentions = contentions.filter((contention) => contention.id !== id);
  return nextContentions.length > 0 ? nextContentions : [createContentionInput(idPrefix, 0)];
}

function normalizeInlineText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function buildContentionTargetText(
  contention: ContentionInput,
  format: ContentionFormat = 'structured'
): string {
  if (format === 'paragraph' && contention.paragraph && contention.paragraph.trim()) {
    return normalizeInlineText(contention.paragraph);
  }

  const structured = CONTENTION_FIELD_CONFIG
    .map(({ field, label }) => {
      const value = normalizeInlineText(contention[field] || '');
      return value ? `${label.replace(/^\d+\.\s*/, '')}: ${value}` : '';
    })
    .filter(Boolean)
    .join('\n');

  if (structured) return structured;
  return contention.paragraph ? normalizeInlineText(contention.paragraph) : '';
}

function buildContentionSignature(contentions: ContentionInput[]) {
  return contentions
    .map((contention) => ({
      uniqueness: normalizeInlineText(contention.uniqueness).toLowerCase(),
      link: normalizeInlineText(contention.link).toLowerCase(),
      impact: normalizeInlineText(contention.impact).toLowerCase(),
      paragraph: normalizeInlineText(contention.paragraph || '').toLowerCase(),
    }))
    .filter(
      (contention) =>
        contention.uniqueness || contention.link || contention.impact || contention.paragraph
    );
}

function buildTargetContentionLabel(
  target: Pick<GenerationTarget, 'text' | 'side' | 'mode' | 'uniqueness' | 'link' | 'impact'>
): string {
  const parts = [
    target.uniqueness?.trim() ? `Uniqueness: ${normalizeInlineText(target.uniqueness)}` : '',
    target.link?.trim() ? `Link: ${normalizeInlineText(target.link)}` : '',
    target.impact?.trim() ? `Impact: ${normalizeInlineText(target.impact)}` : '',
  ].filter(Boolean);

  const prefix = target.mode === 'Defend' ? `[${target.side} Defense]` : `[${target.side}]`;

  if (parts.length === 1 && target.uniqueness?.trim() === normalizeInlineText(target.text)) {
    return `${prefix} Contention: ${normalizeInlineText(target.text)}`;
  }

  return `${prefix} ${parts.length > 0 ? parts.join(' | ') : normalizeInlineText(target.text)}`;
}

function mergeHuntSummaries(base: HuntSummary, next: HuntSummary): HuntSummary {
  return {
    batchesScanned: base.batchesScanned + next.batchesScanned,
    sourcesScanned: base.sourcesScanned + next.sourcesScanned,
    acceptedCards: base.acceptedCards + next.acceptedCards,
    rawCards: base.rawCards + next.rawCards,
    strictCards: base.strictCards + next.strictCards,
    fallbackCards: base.fallbackCards + next.fallbackCards,
    rescueCards: base.rescueCards + next.rescueCards,
  };
}

function createEmptyHuntSummary(): HuntSummary {
  return {
    batchesScanned: 0,
    sourcesScanned: 0,
    acceptedCards: 0,
    rawCards: 0,
    strictCards: 0,
    fallbackCards: 0,
    rescueCards: 0,
  };
}

function buildCardIdentityKey(
  card: Pick<CardData, 'id' | 'citation' | 'bodyHtml' | 'contention'> & { targetId?: string }
): string {
  // API responses and previously stored card data are runtime values, so they
  // can be missing fields even though CardData marks them as required.
  const bodySnippet = typeof card.bodyHtml === 'string'
    ? card.bodyHtml.replace(/\s+/g, ' ').trim().slice(0, 120)
    : '';
  const citation = typeof card.citation === 'string' ? card.citation.trim() : '';
  return [
    card.id,
    card.targetId ?? '',
    card.contention ?? '',
    citation,
    bodySnippet,
  ].join('::');
}

function isUsableCard(card: unknown): card is CardData {
  if (!card || typeof card !== 'object') {
    return false;
  }

  const candidate = card as Partial<CardData>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.contention === 'string' &&
    typeof candidate.tag === 'string' &&
    typeof candidate.citation === 'string' &&
    typeof candidate.bodyHtml === 'string' &&
    typeof candidate.type === 'string'
  );
}

function mergeUniqueCards<T extends CardData & { targetId?: string }>(existing: T[], incoming: T[]): T[] {
  const merged = new Map(existing.map((item) => [buildCardIdentityKey(item), item]));
  incoming.forEach((item) => {
    merged.set(buildCardIdentityKey(item), item);
  });
  return [...merged.values()];
}

function getRenderedCardKey(
  card: Pick<CardData, 'id' | 'citation' | 'bodyHtml' | 'contention'> & { targetId?: string },
  index: number,
  prefix: string
): string {
  return `${prefix}::${buildCardIdentityKey(card)}::${index}`;
}

function getErrorCode(error: unknown): string | undefined {
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    typeof error.code === 'string'
  ) {
    return error.code;
  }

  return undefined;
}

function createCodeError(message: string, code: string): Error & { code: string } {
  const error = new Error(message) as Error & { code: string };
  error.code = code;
  return error;
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error && error.name === 'AbortError')
  );
}

function getCandidateStageLabel(stage: CandidateStage): string {
  switch (stage) {
    case 'strict':
      return 'Accepted via strict pass';
    case 'fallback':
      return 'Accepted via fallback pass';
    case 'rescue':
      return 'Accepted via rescue pass';
    default:
      return 'Rejected candidate';
  }
}

const CONTENTION_FIELD_ORDER: Record<string, number> = {
  UNIQUENESS: 0,
  LINK: 1,
  IMPACT: 2,
};

function orderCardsByContentionField(cardsToOrder: RenderedCard[]): RenderedCard[] {
  return cardsToOrder
    .map((card, index) => ({ card, index }))
    .sort((left, right) => {
      const leftOrder = CONTENTION_FIELD_ORDER[left.card.contention?.toUpperCase() ?? ''] ?? 3;
      const rightOrder = CONTENTION_FIELD_ORDER[right.card.contention?.toUpperCase() ?? ''] ?? 3;
      return leftOrder - rightOrder || left.index - right.index;
    })
    .map(({ card }) => card);
}

function buildDraftTargets(
  affContentions: ContentionInput[],
  negContentions: ContentionInput[],
  supportResponses: string,
  rebuttalSideMode: RebuttalSideMode = 'both',
  contentionFormat: ContentionFormat = 'structured',
  prepMode: ContentionPrepMode = 'attack'
): GenerationTarget[] {
  const supportTargets = supportResponses
    .split('\n')
    .filter((contention) => contention.trim())
    .map((contention) => ({
      text: contention.trim(),
      side: 'Support' as const,
      mode: 'Support' as const,
    }));

  if (supportTargets.length > 0) {
    return supportTargets;
  }

  const targets: GenerationTarget[] = [];
  const targetMode: TargetMode = prepMode === 'defense' ? 'Defend' : 'Attack';

  if (rebuttalSideMode === 'both' || rebuttalSideMode === 'aff') {
    affContentions
      .filter((contention) => hasContentionInputValue(contention, contentionFormat))
      .forEach((contention) => {
        const text = buildContentionTargetText(contention, contentionFormat);
        const uq =
          contentionFormat === 'paragraph'
            ? contention.paragraph?.trim() || contention.uniqueness.trim()
            : contention.uniqueness.trim();
        const lk = contentionFormat === 'paragraph' ? '' : contention.link.trim();
        const imp = contentionFormat === 'paragraph' ? '' : contention.impact.trim();
        targets.push({
          text,
          side: 'Affirmative' as const,
          mode: targetMode,
          uniqueness: uq,
          link: lk,
          impact: imp,
        });
      });
  }

  if (rebuttalSideMode === 'both' || rebuttalSideMode === 'neg') {
    negContentions
      .filter((contention) => hasContentionInputValue(contention, contentionFormat))
      .forEach((contention) => {
        const text = buildContentionTargetText(contention, contentionFormat);
        const uq =
          contentionFormat === 'paragraph'
            ? contention.paragraph?.trim() || contention.uniqueness.trim()
            : contention.uniqueness.trim();
        const lk = contentionFormat === 'paragraph' ? '' : contention.link.trim();
        const imp = contentionFormat === 'paragraph' ? '' : contention.impact.trim();
        targets.push({
          text,
          side: 'Negative' as const,
          mode: targetMode,
          uniqueness: uq,
          link: lk,
          impact: imp,
        });
      });
  }

  return targets;
}

function buildRunSignature(
  topic: string,
  affContentions: ContentionInput[],
  negContentions: ContentionInput[],
  supportResponses: string,
  targetUrl: string,
  rebuttalSideMode: RebuttalSideMode = 'both',
  contentionFormat: ContentionFormat = 'structured',
  prepMode: ContentionPrepMode = 'attack'
): string {
  const normalizedUrls = parseTargetUrls(targetUrl);
  return JSON.stringify({
    topic: normalizeMemoryText(topic),
    rebuttalSideMode,
    prepMode,
    contentionFormat,
    aff: rebuttalSideMode === 'neg' ? [] : buildContentionSignature(affContentions),
    neg: rebuttalSideMode === 'aff' ? [] : buildContentionSignature(negContentions),
    support: supportResponses
      .split('\n')
      .map((value) => normalizeMemoryText(value))
      .filter(Boolean),
    targetUrls: normalizedUrls,
  });
}

function countAcceptedCardsByContentionForRun(
  existingCards: RenderedCard[],
  runSignature: string
): Record<string, number> {
  return existingCards.reduce<Record<string, number>>((acc, card) => {
    if (card._runSignature !== runSignature) {
      return acc;
    }

    const key = card.contention ?? '';
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
}

function normalizeMemoryText(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase();
}

function getUrlHostname(value: string): string {
  try {
    const parsed = new URL(value.startsWith('http') ? value : `https://${value}`);
    return parsed.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

function buildCheckedSiteMemoryKey(topic: string, target: Pick<GenerationTarget, 'text' | 'side' | 'mode'>): string {
  return [
    normalizeMemoryText(topic),
    target.side.toLowerCase(),
    target.mode.toLowerCase(),
    normalizeMemoryText(target.text),
  ].join('::');
}

function readCheckedSiteMemory(): Record<string, string[]> {
  if (typeof window === 'undefined') {
    return {};
  }

  const rawValue = window.localStorage.getItem(CHECKED_SITE_MEMORY_STORAGE_KEY);
  if (!rawValue) {
    return {};
  }

  try {
    const parsed = JSON.parse(rawValue) as Record<string, unknown>;
    const sanitized: Record<string, string[]> = {};

    Object.entries(parsed).forEach(([key, value]) => {
      if (!Array.isArray(value)) {
        return;
      }

      const hosts = Array.from(
        new Set(
          value
            .map((host) => (typeof host === 'string' ? getUrlHostname(host) : ''))
            .filter(Boolean)
        )
      );

      if (hosts.length > 0) {
        sanitized[key] = hosts;
      }
    });

    return sanitized;
  } catch {
    return {};
  }
}

function writeCheckedSiteMemory(memory: Record<string, string[]>) {
  if (typeof window === 'undefined') {
    return;
  }

  if (Object.keys(memory).length === 0) {
    window.localStorage.removeItem(CHECKED_SITE_MEMORY_STORAGE_KEY);
    return;
  }

  window.localStorage.setItem(CHECKED_SITE_MEMORY_STORAGE_KEY, JSON.stringify(memory));
}

function collectCheckedHostsForTargets(
  topic: string,
  targets: Array<Pick<GenerationTarget, 'text' | 'side' | 'mode'>>
): string[] {
  const memory = readCheckedSiteMemory();
  const hosts = new Set<string>();

  targets.forEach((target) => {
    const key = buildCheckedSiteMemoryKey(topic, target);
    (memory[key] || []).forEach((host) => hosts.add(host));
  });

  return [...hosts];
}

function rememberCheckedHostsForTargets(
  topic: string,
  targets: Array<Pick<GenerationTarget, 'text' | 'side' | 'mode'>>,
  urls: string[]
) {
  const hosts = Array.from(new Set(urls.map((url) => getUrlHostname(url)).filter(Boolean)));
  if (hosts.length === 0) {
    return;
  }

  const memory = readCheckedSiteMemory();

  targets.forEach((target) => {
    const key = buildCheckedSiteMemoryKey(topic, target);
    const mergedHosts = Array.from(new Set([...(memory[key] || []), ...hosts]));
    memory[key] = mergedHosts.slice(-MAX_CHECKED_SITES_PER_CONTENTION);
  });

  writeCheckedSiteMemory(memory);
}

function clearCheckedSiteMemory() {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.removeItem(CHECKED_SITE_MEMORY_STORAGE_KEY);
}

function decodeHtmlCodePoint(match: string, rawCodePoint: string, radix: number): string {
  const parsedCodePoint = Number.parseInt(rawCodePoint, radix);

  if (
    !Number.isFinite(parsedCodePoint) ||
    parsedCodePoint < 0 ||
    parsedCodePoint > 0x10ffff
  ) {
    return match;
  }

  return String.fromCodePoint(parsedCodePoint);
}

function decodeBasicHtmlEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (match, codePoint: string) =>
      decodeHtmlCodePoint(match, codePoint, 16)
    )
    .replace(/&#(\d+);/g, (match, codePoint: string) =>
      decodeHtmlCodePoint(match, codePoint, 10)
    )
    .replace(/&nbsp;/gi, ' ')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&');
}

function stripHtmlToText(html: string): string {
  return decodeBasicHtmlEntities(
    html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|h[1-6]|li|blockquote)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sanitizeFilePart(value: string, fallback: string): string {
  const sanitized = stripHtmlToText(value)
    .replace(/[<>:"/\\|?*\x00-\x1f]+/g, ' ')
    .replace(/[^\w.\- ]+/g, ' ')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 70);

  return sanitized || fallback;
}

function getUniqueZipPath(path: string, usedPaths: Set<string>): string {
  if (!usedPaths.has(path)) {
    usedPaths.add(path);
    return path;
  }

  const extensionIndex = path.lastIndexOf('.');
  const basePath = extensionIndex >= 0 ? path.slice(0, extensionIndex) : path;
  const extension = extensionIndex >= 0 ? path.slice(extensionIndex) : '';
  let counter = 2;
  let nextPath = `${basePath}-${counter}${extension}`;

  while (usedPaths.has(nextPath)) {
    counter += 1;
    nextPath = `${basePath}-${counter}${extension}`;
  }

  usedPaths.add(nextPath);
  return nextPath;
}

function writeUInt16LE(buffer: Uint8Array, offset: number, value: number) {
  buffer[offset] = value & 0xff;
  buffer[offset + 1] = (value >>> 8) & 0xff;
}

function writeUInt32LE(buffer: Uint8Array, offset: number, value: number) {
  buffer[offset] = value & 0xff;
  buffer[offset + 1] = (value >>> 8) & 0xff;
  buffer[offset + 2] = (value >>> 16) & 0xff;
  buffer[offset + 3] = (value >>> 24) & 0xff;
}

function getDosDateTime(date: Date): { dosTime: number; dosDate: number } {
  const year = Math.max(1980, date.getFullYear());
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const seconds = Math.floor(date.getSeconds() / 2);

  return {
    dosTime: (hours << 11) | (minutes << 5) | seconds,
    dosDate: ((year - 1980) << 9) | (month << 5) | day,
  };
}

function getCrc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;

  bytes.forEach((byte) => {
    crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  });

  return (crc ^ 0xffffffff) >>> 0;
}

function concatUint8Arrays(chunks: Uint8Array[]): Uint8Array {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new Uint8Array(totalLength);
  let offset = 0;

  chunks.forEach((chunk) => {
    output.set(chunk, offset);
    offset += chunk.length;
  });

  return output;
}

function createZipBlob(files: ZipSourceFile[]): Blob {
  const encoder = new TextEncoder();
  const createdAt = new Date();
  const { dosTime, dosDate } = getDosDateTime(createdAt);
  const fileChunks: Uint8Array[] = [];
  const centralDirectoryEntries: ZipCentralDirectoryEntry[] = [];
  let offset = 0;

  files.forEach((file) => {
    const filenameBytes = encoder.encode(file.path.replace(/\\/g, '/'));
    const contentBytes = encoder.encode(file.content);
    const crc32 = getCrc32(contentBytes);
    const localHeader = new Uint8Array(30 + filenameBytes.length);

    writeUInt32LE(localHeader, 0, ZIP_LOCAL_FILE_HEADER_SIGNATURE);
    writeUInt16LE(localHeader, 4, 20);
    writeUInt16LE(localHeader, 6, ZIP_UTF8_GENERAL_PURPOSE_FLAG);
    writeUInt16LE(localHeader, 8, 0);
    writeUInt16LE(localHeader, 10, dosTime);
    writeUInt16LE(localHeader, 12, dosDate);
    writeUInt32LE(localHeader, 14, crc32);
    writeUInt32LE(localHeader, 18, contentBytes.length);
    writeUInt32LE(localHeader, 22, contentBytes.length);
    writeUInt16LE(localHeader, 26, filenameBytes.length);
    writeUInt16LE(localHeader, 28, 0);
    localHeader.set(filenameBytes, 30);

    fileChunks.push(localHeader, contentBytes);
    centralDirectoryEntries.push({
      filenameBytes,
      crc32,
      compressedSize: contentBytes.length,
      uncompressedSize: contentBytes.length,
      offset,
      dosTime,
      dosDate,
    });
    offset += localHeader.length + contentBytes.length;
  });

  const centralDirectoryStart = offset;
  const centralDirectoryChunks = centralDirectoryEntries.map((entry) => {
    const centralHeader = new Uint8Array(46 + entry.filenameBytes.length);

    writeUInt32LE(centralHeader, 0, ZIP_CENTRAL_DIRECTORY_SIGNATURE);
    writeUInt16LE(centralHeader, 4, 20);
    writeUInt16LE(centralHeader, 6, 20);
    writeUInt16LE(centralHeader, 8, ZIP_UTF8_GENERAL_PURPOSE_FLAG);
    writeUInt16LE(centralHeader, 10, 0);
    writeUInt16LE(centralHeader, 12, entry.dosTime);
    writeUInt16LE(centralHeader, 14, entry.dosDate);
    writeUInt32LE(centralHeader, 16, entry.crc32);
    writeUInt32LE(centralHeader, 20, entry.compressedSize);
    writeUInt32LE(centralHeader, 24, entry.uncompressedSize);
    writeUInt16LE(centralHeader, 28, entry.filenameBytes.length);
    writeUInt16LE(centralHeader, 30, 0);
    writeUInt16LE(centralHeader, 32, 0);
    writeUInt16LE(centralHeader, 34, 0);
    writeUInt16LE(centralHeader, 36, 0);
    writeUInt32LE(centralHeader, 38, 0);
    writeUInt32LE(centralHeader, 42, entry.offset);
    centralHeader.set(entry.filenameBytes, 46);

    return centralHeader;
  });
  const centralDirectorySize = centralDirectoryChunks.reduce(
    (sum, chunk) => sum + chunk.length,
    0
  );
  const endOfCentralDirectory = new Uint8Array(22);

  writeUInt32LE(endOfCentralDirectory, 0, ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE);
  writeUInt16LE(endOfCentralDirectory, 4, 0);
  writeUInt16LE(endOfCentralDirectory, 6, 0);
  writeUInt16LE(endOfCentralDirectory, 8, centralDirectoryEntries.length);
  writeUInt16LE(endOfCentralDirectory, 10, centralDirectoryEntries.length);
  writeUInt32LE(endOfCentralDirectory, 12, centralDirectorySize);
  writeUInt32LE(endOfCentralDirectory, 16, centralDirectoryStart);
  writeUInt16LE(endOfCentralDirectory, 20, 0);

  const zipBytes = concatUint8Arrays([
    ...fileChunks,
    ...centralDirectoryChunks,
    endOfCentralDirectory,
  ]);
  const zipBuffer = zipBytes.buffer.slice(
    zipBytes.byteOffset,
    zipBytes.byteOffset + zipBytes.byteLength
  ) as ArrayBuffer;

  return new Blob(
    [zipBuffer],
    { type: 'application/zip' }
  );
}

function isRenderedCandidateCard(
  card: RenderedCard | RenderedCandidateCard
): card is RenderedCandidateCard {
  return 'status' in card;
}

function getExportHtmlStyles(): string {
  return `
    body {
      color: #111827;
      font-family: Arial, sans-serif;
      line-height: 1.45;
      margin: 32px auto;
      max-width: 820px;
      padding: 0 24px;
    }
    h1, h2, h3 {
      line-height: 1.2;
    }
    .meta {
      color: #4b5563;
      font-size: 12px;
      margin: 4px 0;
    }
    .card {
      border-top: 1px solid #d1d5db;
      margin-top: 24px;
      padding-top: 20px;
    }
    .tag {
      font-size: 18px;
      margin: 0 0 8px;
    }
    .citation {
      color: #374151;
      font-size: 14px;
      font-style: italic;
      margin: 0 0 16px;
    }
    .body {
      font-size: 8pt;
      line-height: 1.5;
      white-space: pre-wrap;
    }
    .body u {
      color: #111827;
      font-size: 8pt;
      text-decoration: underline;
    }
    .body strong {
      color: #111827;
      font-size: 8pt;
      font-weight: 500;
    }
    .body mark {
      background: #00d9ff;
      color: #001b2e;
      font-size: 8pt;
      font-weight: 800;
      padding: 0 2px;
    }
  `;
}

function renderCardHtmlFragment(
  card: RenderedCard | RenderedCandidateCard,
  sectionLabel: string,
  index: number
): string {
  const hasTag = card.tag.trim().length > 0;
  const ratingDetails = card.qualityRating
    ? `
      <p class="meta"><strong>Ranking:</strong> ${card.qualityRating.score}/10 - ${escapeHtml(card.qualityRating.label)}</p>
      <p class="meta"><strong>Ranking rationale:</strong> ${escapeHtml(card.qualityRating.rationale)}</p>
    `
    : '';
  const candidateDetails = isRenderedCandidateCard(card)
    ? `
      <p class="meta"><strong>Status:</strong> ${escapeHtml(card.status)}</p>
      <p class="meta"><strong>Validation:</strong> ${escapeHtml(getCandidateStageLabel(card.validationStage))}</p>
      <p class="meta"><strong>Note:</strong> ${escapeHtml(card.note)}</p>
    `
    : '';

  return `
    <article class="card">
      <p class="meta"><strong>${escapeHtml(sectionLabel)} ${index + 1}</strong></p>
      <p class="meta"><strong>Contention:</strong> ${escapeHtml(card.contention || 'General Arguments')}</p>
      <p class="meta"><strong>Type:</strong> ${escapeHtml(card.type || 'General')}</p>
      ${ratingDetails}
      ${candidateDetails}
      ${hasTag ? `<h2 class="tag">${escapeHtml(card.tag)}</h2>` : ''}
      <p class="citation">${escapeHtml(card.citation)}</p>
      <div class="body">${card.bodyHtml}</div>
    </article>
  `;
}

function renderCardHtmlDocument(
  card: RenderedCard | RenderedCandidateCard,
  sectionLabel: string,
  index: number
): string {
  const title = `${sectionLabel} ${index + 1}: ${card.tag || card.contention || 'Debate Card'}`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>
  <style>${getExportHtmlStyles()}</style>
</head>
<body>
  ${renderCardHtmlFragment(card, sectionLabel, index)}
</body>
</html>`;
}

function renderAllResultsHtmlDocument(
  exportTopic: string,
  exportedAt: string,
  acceptedCards: RenderedCard[],
  reviewCards: RenderedCandidateCard[]
): string {
  const acceptedSection =
    acceptedCards.length > 0
      ? acceptedCards
          .map((card, index) => renderCardHtmlFragment(card, 'Successful Card', index))
          .join('\n')
      : '<p>No successful cards were exported.</p>';
  const candidateSection =
    reviewCards.length > 0
      ? reviewCards
          .map((card, index) => renderCardHtmlFragment(card, 'Candidate Card', index))
          .join('\n')
      : '<p>No candidate cards were exported.</p>';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(exportTopic || 'Debate Card Results')}</title>
  <style>${getExportHtmlStyles()}</style>
</head>
<body>
  <h1>${escapeHtml(exportTopic || 'Debate Card Results')}</h1>
  <p class="meta"><strong>Exported:</strong> ${escapeHtml(exportedAt)}</p>
  <p class="meta"><strong>Successful cards:</strong> ${acceptedCards.length}</p>
  <p class="meta"><strong>Candidate cards:</strong> ${reviewCards.length}</p>
  <h2>Successful Cards</h2>
  ${acceptedSection}
  <h2>Candidate Cards</h2>
  ${candidateSection}
</body>
</html>`;
}

function renderCardText(
  card: RenderedCard | RenderedCandidateCard,
  sectionLabel: string,
  index: number
): string {
  const rankingLines = card.qualityRating
    ? [
        `Ranking: ${card.qualityRating.score}/10 - ${card.qualityRating.label}`,
        `Ranking rationale: ${card.qualityRating.rationale}`,
      ]
    : [];
  const candidateLines = isRenderedCandidateCard(card)
    ? [
        `Status: ${card.status}`,
        `Validation: ${getCandidateStageLabel(card.validationStage)}`,
        `Note: ${card.note}`,
      ]
    : [];

  return [
    `${sectionLabel} ${index + 1}`,
    `Contention: ${card.contention || 'General Arguments'}`,
    `Type: ${card.type}`,
    ...rankingLines,
    ...candidateLines,
    card.tag.trim() ? `Tag: ${card.tag}` : '',
    `Citation: ${card.citation}`,
    '',
    stripHtmlToText(card.bodyHtml),
  ]
    .filter((line) => line !== '')
    .join('\n');
}

function serializeCardForExport(card: RenderedCard | RenderedCandidateCard) {
  return {
    id: card.id,
    targetId: card.targetId,
    contention: card.contention,
    type: card.type,
    tag: card.tag,
    citation: card.citation,
    bodyHtml: card.bodyHtml,
    bodyText: stripHtmlToText(card.bodyHtml),
    qualityRating: card.qualityRating ?? null,
    reasoning: card.reasoning ?? '',
    target: card._rawTarget
      ? {
          text: card._rawTarget.text,
          side: card._rawTarget.side,
          mode: card._rawTarget.mode,
          contention: card._rawTarget.contention,
        }
      : null,
    candidate: isRenderedCandidateCard(card)
      ? {
          status: card.status,
          validationStage: card.validationStage,
          validationLabel: getCandidateStageLabel(card.validationStage),
          note: card.note,
        }
      : null,
  };
}

function getCardExportBaseName(
  card: RenderedCard | RenderedCandidateCard,
  index: number,
  fallbackPrefix: string
): string {
  const paddedIndex = String(index + 1).padStart(2, '0');
  const label = sanitizeFilePart(card.tag || card.contention || '', `${fallbackPrefix}-${paddedIndex}`);

  return `${paddedIndex}-${label}`;
}

function buildResultsExportFiles({
  topic,
  acceptedCards,
  reviewCards,
  huntSummary,
  statusMsg,
}: {
  topic: string;
  acceptedCards: RenderedCard[];
  reviewCards: RenderedCandidateCard[];
  huntSummary: HuntSummary | null;
  statusMsg: string;
}): ZipSourceFile[] {
  const exportedAt = new Date().toISOString();
  const usedPaths = new Set<string>();
  const files: ZipSourceFile[] = [];
  const addFile = (path: string, content: string) => {
    files.push({ path: getUniqueZipPath(path, usedPaths), content });
  };

  addFile(
    'summary.json',
    JSON.stringify(
      {
        exportedAt,
        topic,
        statusMsg,
        counts: {
          successfulCards: acceptedCards.length,
          candidateCards: reviewCards.length,
        },
        huntSummary,
        successfulCards: acceptedCards.map(serializeCardForExport),
        candidateCards: reviewCards.map(serializeCardForExport),
      },
      null,
      2
    )
  );
  addFile(
    'all-results.html',
    renderAllResultsHtmlDocument(topic, exportedAt, acceptedCards, reviewCards)
  );

  acceptedCards.forEach((card, index) => {
    const baseName = getCardExportBaseName(card, index, 'successful-card');
    addFile(`successful-cards/${baseName}.html`, renderCardHtmlDocument(card, 'Successful Card', index));
    addFile(`successful-cards/${baseName}.txt`, renderCardText(card, 'Successful Card', index));
  });

  reviewCards.forEach((card, index) => {
    const baseName = getCardExportBaseName(card, index, 'candidate-card');
    addFile(`candidate-cards/${baseName}.html`, renderCardHtmlDocument(card, 'Candidate Card', index));
    addFile(`candidate-cards/${baseName}.txt`, renderCardText(card, 'Candidate Card', index));
  });

  return files;
}

function getCheckedSiteStats(
  topic: string,
  targets: Array<Pick<GenerationTarget, 'text' | 'side' | 'mode'>>
): CheckedSiteStats {
  const memory = readCheckedSiteMemory();
  const totalSites = new Set(Object.values(memory).flat()).size;
  const matchingHosts = new Set(collectCheckedHostsForTargets(topic, targets));
  const trackedContentions = targets.filter((target) => {
    const key = buildCheckedSiteMemoryKey(topic, target);
    return (memory[key] || []).length > 0;
  }).length;

  return {
    totalSites,
    matchingSites: matchingHosts.size,
    trackedContentions,
  };
}

interface ContentionFormatSliderProps {
  format: ContentionFormat;
  onChange: (format: ContentionFormat) => void;
  disabled?: boolean;
}

function ContentionFormatSlider({ format, onChange, disabled }: ContentionFormatSliderProps) {
  const isParagraph = format === 'paragraph';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
        <span
          style={{
            fontSize: '0.75rem',
            fontWeight: 700,
            color: 'var(--muted-foreground)',
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
          }}
        >
          Contention Format
        </span>
        <span
          style={{
            fontSize: '0.72rem',
            color: 'var(--primary)',
            fontWeight: 700,
          }}
        >
          {isParagraph ? 'Single Paragraph' : 'UQ · Link · Impact'}
        </span>
      </div>

      <div
        role="group"
        aria-label="Contention input format slider"
        onClick={() => {
          if (!disabled) {
            onChange(isParagraph ? 'structured' : 'paragraph');
          }
        }}
        style={{
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          background: 'var(--secondary)',
          borderRadius: '999px',
          border: '1px solid var(--border)',
          padding: '3px',
          width: '270px',
          height: '38px',
          cursor: disabled ? 'not-allowed' : 'pointer',
          userSelect: 'none',
          boxShadow: 'none',
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: '3px',
            bottom: '3px',
            left: isParagraph ? 'calc(50% + 1px)' : '3px',
            width: 'calc(50% - 4px)',
            background: isParagraph
              ? 'linear-gradient(135deg, #9333ea 0%, #6366f1 100%)'
              : 'linear-gradient(135deg, #0284c7 0%, #2563eb 100%)',
            borderRadius: '999px',
            boxShadow: isParagraph
              ? '0 2px 10px rgba(147, 51, 234, 0.5)'
              : '0 2px 10px rgba(2, 132, 199, 0.5)',
            transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
            zIndex: 1,
          }}
        />

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (!disabled) onChange('structured');
          }}
          disabled={disabled}
          style={{
            position: 'relative',
            zIndex: 2,
            flex: 1,
            height: '100%',
            background: 'transparent',
            border: 'none',
            color: !isParagraph ? 'var(--primary-foreground)' : 'var(--muted-foreground)',
            fontSize: '0.78rem',
            fontWeight: !isParagraph ? 700 : 500,
            cursor: disabled ? 'not-allowed' : 'pointer',
            textAlign: 'center',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.35rem',
            padding: '0 0.4rem',
            whiteSpace: 'nowrap',
            transition: 'color 0.2s ease',
          }}
        >
          <span>📊</span>
          <span>UQ / Link / Impact</span>
        </button>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (!disabled) onChange('paragraph');
          }}
          disabled={disabled}
          style={{
            position: 'relative',
            zIndex: 2,
            flex: 1,
            height: '100%',
            background: 'transparent',
            border: 'none',
            color: isParagraph ? 'var(--primary-foreground)' : 'var(--muted-foreground)',
            fontSize: '0.78rem',
            fontWeight: isParagraph ? 700 : 500,
            cursor: disabled ? 'not-allowed' : 'pointer',
            textAlign: 'center',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.35rem',
            padding: '0 0.4rem',
            whiteSpace: 'nowrap',
            transition: 'color 0.2s ease',
          }}
        >
          <span>📝</span>
          <span>Paragraph</span>
        </button>
      </div>
    </div>
  );
}

interface RebuttalSideSelectorProps {
  mode: RebuttalSideMode;
  onChange: (mode: RebuttalSideMode) => void;
  disabled?: boolean;
}

function RebuttalSideSelector({ mode, onChange, disabled }: RebuttalSideSelectorProps) {
  const options: Array<{ id: RebuttalSideMode; label: string; icon: string; title: string }> = [
    { id: 'both', label: 'Both (Aff & Neg)', icon: '⚖️', title: 'Hunt attacks against both Aff and Neg' },
    { id: 'aff', label: 'Only Aff Contentions', icon: '🔴', title: 'Hunt NEG attacks on affirmative claims' },
    { id: 'neg', label: 'Only Neg Contentions', icon: '🔵', title: 'Hunt AFF attacks on negative claims' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
      <span
        style={{
          fontSize: '0.75rem',
          fontWeight: 700,
          color: 'var(--muted-foreground)',
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
        }}
      >
        Rebuttal Target Side
      </span>

      <div
        style={{
          display: 'inline-flex',
          background: 'var(--secondary)',
          padding: '3px',
          borderRadius: '999px',
          border: '1px solid var(--border)',
          gap: '3px',
          boxShadow: 'none',
        }}
      >
        {options.map((opt) => {
          const isActive = mode === opt.id;
          let activeBg = 'linear-gradient(135deg, #6366f1, #4f46e5)';
          if (opt.id === 'aff') {
            activeBg = 'linear-gradient(135deg, #ef4444, #dc2626)';
          } else if (opt.id === 'neg') {
            activeBg = 'linear-gradient(135deg, #3b82f6, #2563eb)';
          }

          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => onChange(opt.id)}
              disabled={disabled}
              title={opt.title}
              style={{
                padding: '0.45rem 0.85rem',
                borderRadius: '999px',
                border: 'none',
                background: isActive ? activeBg : 'transparent',
                color: isActive ? 'var(--primary-foreground)' : 'var(--muted-foreground)',
                fontSize: '0.78rem',
                fontWeight: isActive ? 700 : 500,
                cursor: disabled ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '0.35rem',
                transition: 'all 0.2s ease',
                boxShadow: isActive ? '0 2px 8px rgba(0, 0, 0, 0.35)' : 'none',
                whiteSpace: 'nowrap',
              }}
            >
              <span>{opt.icon}</span>
              <span>{opt.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

interface PrepModeSelectorProps {
  mode: ContentionPrepMode;
  onChange: (mode: ContentionPrepMode) => void;
  disabled?: boolean;
}

function PrepModeSelector({ mode, onChange, disabled }: PrepModeSelectorProps) {
  const isDefense = mode === 'defense';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
        <span
          style={{
            fontSize: '0.75rem',
            fontWeight: 700,
            color: 'var(--muted-foreground)',
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
          }}
        >
          Strategy Mode
        </span>
        <span
          style={{
            fontSize: '0.72rem',
            color: 'var(--primary)',
            fontWeight: 700,
          }}
        >
          {isDefense ? 'Defense / Frontline' : 'Attack / Rebuttal'}
        </span>
      </div>

      <div
        style={{
          display: 'inline-flex',
          background: 'var(--secondary)',
          padding: '3px',
          borderRadius: '999px',
          border: '1px solid var(--border)',
          gap: '3px',
          boxShadow: 'none',
        }}
      >
        <button
          type="button"
          onClick={() => onChange('attack')}
          disabled={disabled}
          title="Hunt refutations, turns, non-uniques, and delinks to attack contentions"
          style={{
            padding: '0.45rem 0.85rem',
            borderRadius: '999px',
            border: 'none',
            background: !isDefense ? 'linear-gradient(135deg, #ef4444, #b91c1c)' : 'transparent',
            color: !isDefense ? 'var(--primary-foreground)' : 'var(--muted-foreground)',
            fontSize: '0.78rem',
            fontWeight: !isDefense ? 700 : 500,
            cursor: disabled ? 'not-allowed' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '0.35rem',
            transition: 'all 0.2s ease',
            boxShadow: !isDefense ? '0 2px 8px rgba(239, 68, 68, 0.4)' : 'none',
            whiteSpace: 'nowrap',
          }}
        >
          <span>⚔️</span>
          <span>Attack Mode</span>
        </button>

        <button
          type="button"
          onClick={() => onChange('defense')}
          disabled={disabled}
          title="Hunt defensive cards and frontline evidence to defend your contentions from opponent responses"
          style={{
            padding: '0.45rem 0.85rem',
            borderRadius: '999px',
            border: 'none',
            background: isDefense ? 'linear-gradient(135deg, #10b981, #047857)' : 'transparent',
            color: isDefense ? 'var(--primary-foreground)' : 'var(--muted-foreground)',
            fontSize: '0.78rem',
            fontWeight: isDefense ? 700 : 500,
            cursor: disabled ? 'not-allowed' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '0.35rem',
            transition: 'all 0.2s ease',
            boxShadow: isDefense ? '0 2px 8px rgba(16, 185, 129, 0.4)' : 'none',
            whiteSpace: 'nowrap',
          }}
        >
          <span>🛡️</span>
          <span>Defense Mode</span>
        </button>
      </div>
    </div>
  );
}

function ContentionEditor({
  title,
  accentColor,
  borderColor,
  contentions,
  format,
  disabled,
  onAdd,
  onRemove,
  onUpdate,
}: ContentionEditorProps) {
  return (
    <div style={{ flex: 1, minWidth: '280px' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '1rem',
          marginBottom: '0.75rem',
        }}
      >
        <label
          style={{
            display: 'block',
            fontWeight: 'bold',
            color: accentColor,
          }}
        >
          {title}
        </label>
        <button
          type="button"
          onClick={onAdd}
          disabled={disabled}
          style={{
            padding: '0.55rem 0.75rem',
            background: 'var(--secondary)',
            border: `1px solid ${borderColor}`,
            color: 'var(--foreground)',
            borderRadius: '8px',
            cursor: disabled ? 'not-allowed' : 'pointer',
            fontWeight: 'bold',
            opacity: disabled ? 0.65 : 1,
            whiteSpace: 'nowrap',
          }}
        >
          + Add Contention
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
        {contentions.map((contention, index) => (
          <div
            key={contention.id}
            style={{
              padding: '1rem',
              background: 'var(--card)',
              border: `1px solid ${borderColor}`,
              borderRadius: '8px',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '0.75rem',
                marginBottom: '0.75rem',
              }}
            >
              <span style={{ color: 'var(--foreground)', fontWeight: 'bold' }}>
                Contention {index + 1}
              </span>
              <button
                type="button"
                onClick={() => onRemove(contention.id)}
                disabled={disabled || contentions.length === 1}
                style={{
                  padding: '0.35rem 0.55rem',
                  background: 'transparent',
                  border: '1px solid var(--border)',
                  color:
                    disabled || contentions.length === 1
                      ? 'var(--muted-foreground)'
                      : 'var(--foreground)',
                  borderRadius: '6px',
                  cursor: disabled || contentions.length === 1 ? 'not-allowed' : 'pointer',
                }}
              >
                Remove
              </button>
            </div>

            {format === 'paragraph' ? (
              <label
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.4rem',
                  color: 'var(--foreground)',
                  fontSize: '0.9rem',
                  fontWeight: 'bold',
                }}
              >
                Contention Description (Paragraph)
                <textarea
                  value={contention.paragraph ?? ''}
                  onChange={(e) => onUpdate(contention.id, 'paragraph', e.target.value)}
                  placeholder="Describe the contention in full (e.g. status quo problem, causal link/mechanism, and expected impact/harms)..."
                  rows={4}
                  style={{
                    width: '100%',
                    minHeight: '6.5rem',
                    padding: '0.75rem',
                    background: 'var(--input-bg)',
                    border: '1px solid var(--card-border)',
                    color: 'var(--foreground)',
                    borderRadius: '8px',
                    resize: 'vertical',
                    lineHeight: 1.4,
                  }}
                  disabled={disabled}
                />
              </label>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
                {CONTENTION_FIELD_CONFIG.map(({ field, label, placeholder }) => (
                  <label
                    key={field}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.35rem',
                      color: 'var(--foreground)',
                      fontSize: '0.9rem',
                      fontWeight: 'bold',
                    }}
                  >
                    {label}
                    <textarea
                      value={contention[field]}
                      onChange={(e) => onUpdate(contention.id, field, e.target.value)}
                      placeholder={placeholder}
                      rows={2}
                      style={{
                        width: '100%',
                        minHeight: '4.25rem',
                        padding: '0.7rem',
                        background: 'var(--input-bg)',
                        border: '1px solid var(--card-border)',
                        color: 'var(--foreground)',
                        borderRadius: '8px',
                        resize: 'vertical',
                        lineHeight: 1.35,
                      }}
                      disabled={disabled}
                    />
                  </label>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export function DebateForm() {
  const [activeTab, setActiveTab] = useState<TabId>('auto-carder');
  const resultsSectionRef = useRef<HTMLDivElement | null>(null);
  const huntAbortControllerRef = useRef<AbortController | null>(null);
  const huntStopRequestedRef = useRef(false);
  const wakeLockRef = useRef<ScreenWakeLockSentinel | null>(null);
  const [hasLoadedStoredForm, setHasLoadedStoredForm] = useState(false);
  const [topic, setTopic] = useState('');
  const [rebuttalSideMode, setRebuttalSideMode] = useState<RebuttalSideMode>('both');
  const [prepMode, setPrepMode] = useState<ContentionPrepMode>('attack');
  const [contentionFormat, setContentionFormat] = useState<ContentionFormat>('structured');
  const [affContentions, setAffContentions] = useState<ContentionInput[]>(() =>
    [createContentionInput('aff', 0)]
  );
  const [negContentions, setNegContentions] = useState<ContentionInput[]>(() =>
    [createContentionInput('neg', 0)]
  );
  const [supportResponses, setSupportResponses] = useState('');
  const [targetUrl, setTargetUrl] = useState('');
  const [includeTagLine, setIncludeTagLine] = useState(true);
  const [cardCount, setCardCount] = useState(5);
  const [findUntilStopped, setFindUntilStopped] = useState(false);

  const [isLoading, setIsLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [countdown, setCountdown] = useState(0);

  const [cards, setCards] = useState<RenderedCard[]>([]);
  const [candidateCards, setCandidateCards] = useState<RenderedCandidateCard[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [huntSummary, setHuntSummary] = useState<HuntSummary | null>(null);
  const [taglineLoadingIds, setTaglineLoadingIds] = useState<Record<string, boolean>>({});
  const [rankingLoadingIds, setRankingLoadingIds] = useState<Record<string, boolean>>({});
  const [isSortingByRanking, setIsSortingByRanking] = useState(false);
  const [huntStopRequested, setHuntStopRequested] = useState(false);
  const [allCopied, setAllCopied] = useState(false);

  const [articlePool, setArticlePool] = useState<ArticlePoolItem[]>([]);
  const [poolProgress, setPoolProgress] = useState<Record<string, number>>({});
  const [feedbacks, setFeedbacks] = useState<Record<string, string>>({});
  const [checkedSiteStats, setCheckedSiteStats] = useState<CheckedSiteStats>({
    totalSites: 0,
    matchingSites: 0,
    trackedContentions: 0,
  });

  const parsedTargetUrls = parseTargetUrls(targetUrl);
  const parsedTargetUrlsCount = parsedTargetUrls.length;

  useEffect(() => {
    setTopic(getStoredString(FORM_STORAGE_KEYS.topic));
    setAffContentions(parseStoredContentions(FORM_STORAGE_KEYS.affContentions, 'aff'));
    setNegContentions(parseStoredContentions(FORM_STORAGE_KEYS.negContentions, 'neg'));
    const storedSideMode = getStoredString(FORM_STORAGE_KEYS.rebuttalSideMode);
    if (storedSideMode === 'aff' || storedSideMode === 'neg' || storedSideMode === 'both') {
      setRebuttalSideMode(storedSideMode);
    }
    const storedPrepMode = getStoredString(FORM_STORAGE_KEYS.prepMode);
    if (storedPrepMode === 'attack' || storedPrepMode === 'defense') {
      setPrepMode(storedPrepMode);
    }
    const storedFormat = getStoredString(FORM_STORAGE_KEYS.contentionFormat);
    if (storedFormat === 'structured' || storedFormat === 'paragraph') {
      setContentionFormat(storedFormat);
    }
    setSupportResponses(getStoredString(FORM_STORAGE_KEYS.supportResponses));
    setTargetUrl(getStoredString(FORM_STORAGE_KEYS.targetUrl));
    setIncludeTagLine(getStoredBoolean(FORM_STORAGE_KEYS.includeTagLine, true));
    setCardCount(getStoredNumber(FORM_STORAGE_KEYS.cardCount, 5));
    setFindUntilStopped(getStoredBoolean(FORM_STORAGE_KEYS.findUntilStopped, false));
    setHasLoadedStoredForm(true);
  }, []);

  useEffect(() => {
    if (!hasLoadedStoredForm) {
      return;
    }

    persistStoredValue(FORM_STORAGE_KEYS.topic, topic);
    persistStoredValue(FORM_STORAGE_KEYS.rebuttalSideMode, rebuttalSideMode);
    persistStoredValue(FORM_STORAGE_KEYS.prepMode, prepMode);
    persistStoredValue(FORM_STORAGE_KEYS.contentionFormat, contentionFormat);
    persistStoredValue(
      FORM_STORAGE_KEYS.affContentions,
      serializeContentionsForStorage(affContentions)
    );
    persistStoredValue(
      FORM_STORAGE_KEYS.negContentions,
      serializeContentionsForStorage(negContentions)
    );
    persistStoredValue(FORM_STORAGE_KEYS.supportResponses, supportResponses);
    persistStoredValue(FORM_STORAGE_KEYS.targetUrl, targetUrl);
    persistStoredValue(FORM_STORAGE_KEYS.includeTagLine, includeTagLine);
    persistStoredValue(FORM_STORAGE_KEYS.cardCount, cardCount);
    persistStoredValue(FORM_STORAGE_KEYS.findUntilStopped, findUntilStopped);
  }, [
    affContentions,
    cardCount,
    contentionFormat,
    findUntilStopped,
    hasLoadedStoredForm,
    includeTagLine,
    negContentions,
    prepMode,
    rebuttalSideMode,
    supportResponses,
    targetUrl,
    topic,
  ]);

  const hasVisibleResults = cards.length > 0 || candidateCards.length > 0;
  const beginHuntSession = () => {
    huntStopRequestedRef.current = false;
    setHuntStopRequested(false);
    const controller = new AbortController();
    huntAbortControllerRef.current = controller;
    return controller;
  };

  const clearHuntSession = (controller: AbortController | null) => {
    if (!controller || huntAbortControllerRef.current === controller) {
      huntAbortControllerRef.current = null;
    }
    huntStopRequestedRef.current = false;
    setHuntStopRequested(false);
  };

  const throwIfHuntStopped = () => {
    if (huntStopRequestedRef.current) {
      throw createCodeError('Evidence hunt stopped by you.', HUNT_STOPPED_ERROR_CODE);
    }
  };

  const sleepWithStopCheck = async (durationMs: number) => {
    let elapsed = 0;

    while (elapsed < durationMs) {
      throwIfHuntStopped();
      const step = Math.min(250, durationMs - elapsed);
      await new Promise((resolve) => setTimeout(resolve, step));
      elapsed += step;
    }

    throwIfHuntStopped();
  };

  const handleStopHunt = () => {
    if (!isLoading) {
      return;
    }

    huntStopRequestedRef.current = true;
    setHuntStopRequested(true);
    huntAbortControllerRef.current?.abort();
    setCountdown(0);
    setStatusMsg('Stopping evidence hunt...');
  };

  const refreshCheckedSiteStats = (
    nextTopic = topic,
    nextTargets = buildDraftTargets(
      affContentions,
      negContentions,
      supportResponses,
      rebuttalSideMode,
      contentionFormat,
      prepMode
    )
  ) => {
    setCheckedSiteStats(getCheckedSiteStats(nextTopic, nextTargets));
  };

  useEffect(() => {
    if (error && hasVisibleResults) {
      resultsSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [error, hasVisibleResults]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const wakeLockNavigator = navigator as WakeLockCapableNavigator;
    if (!wakeLockNavigator.wakeLock?.request) {
      return;
    }

    let isActive = true;

    const releaseWakeLock = async () => {
      const sentinel = wakeLockRef.current;
      wakeLockRef.current = null;

      if (!sentinel) {
        return;
      }

      try {
        await sentinel.release();
      } catch {
        // Ignore release failures. The browser may have already released the lock.
      }
    };

    const requestWakeLock = async () => {
      if (!isActive || !isLoading) {
        return;
      }

      if (wakeLockRef.current && wakeLockRef.current.released !== true) {
        return;
      }

      try {
        const sentinel = await wakeLockNavigator.wakeLock.request('screen');

        if (!isActive || !isLoading) {
          try {
            await sentinel.release();
          } catch {
            // Ignore late cleanup failures.
          }
          return;
        }

        wakeLockRef.current = sentinel;
        sentinel.addEventListener?.('release', () => {
          if (wakeLockRef.current === sentinel) {
            wakeLockRef.current = null;
          }
        });
      } catch (error) {
        console.warn('Screen wake lock request failed.', error);
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void requestWakeLock();
      }
    };

    if (isLoading) {
      void requestWakeLock();
      document.addEventListener('visibilitychange', handleVisibilityChange);
    } else {
      void releaseWakeLock();
    }

    return () => {
      isActive = false;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      void releaseWakeLock();
    };
  }, [isLoading]);

  useEffect(() => {
    setCheckedSiteStats(
      getCheckedSiteStats(
        topic,
        buildDraftTargets(
          affContentions,
          negContentions,
          supportResponses,
          rebuttalSideMode,
          contentionFormat,
          prepMode
        )
      )
    );
  }, [affContentions, contentionFormat, negContentions, prepMode, rebuttalSideMode, supportResponses, topic]);

  const processArticleBatches = async (
    activeTargets: HydratedTarget[],
    pool: ArticlePoolItem[],
    startIndex: number,
    isDeepCut = false,
    runSignature: string
  ) => {
    throwIfHuntStopped();
    let articleIndex = startIndex;
    let appendedCount = 0;
    let successfulBatchesSinceCooldown = 0;
    let batchesScanned = 0;
    let sourcesScanned = 0;
    let rawCards = 0;
    let strictCards = 0;
    let fallbackCards = 0;
    let rescueCards = 0;
    let remainingTargets = structuredClone(activeTargets);
    const targetLookup = new Map(activeTargets.map((target) => [target.id, target]));
    const groqApiKeySlotCount = Math.max(1, getAiConfigFromStorage('planner', false).apiKeys?.length ?? 0);
    let checkedSiteMemoryUpdated = false;

    while (remainingTargets.length > 0 && articleIndex < pool.length) {
      throwIfHuntStopped();
      // Process one source at a time so accepted cards reach the workspace
      // immediately and the hunt can keep advancing until all targets are full.
      const batch = pool.slice(articleIndex, articleIndex + 1);
      if (batch.length === 0) break;
      const batchTargets = remainingTargets.map(({ text, side, mode }) => ({ text, side, mode }));
      let batchAcceptedCount = 0;
      const batchNumber = articleIndex;
      let batchRawCards = 0;
      let batchStrictCards = 0;
      let batchFallbackCards = 0;
      let batchRescueCards = 0;

      const targetsSummaries = remainingTargets
        .map((target) => `${target.side.substring(0, 3)}:${target.cardsNeeded}`)
        .join(', ');
      setStatusMsg(
        `Scanning web source ${articleIndex + 1} against: (${targetsSummaries})...`
      );

      const aiStorageConfig = getAiConfigFromStorage('planner');
      const configuredApiKeys = aiStorageConfig.groqApiKeys ?? [];
      const apiBody: GenerateRequestBody = {
        topic,
        targets: remainingTargets,
        feedback: remainingTargets
          .map((target) => target.feedback)
          .filter((feedback): feedback is string => Boolean(feedback))
          .join(' | '),
        groqApiKeys: aiStorageConfig.groqApiKeys,
        groqApiKeyRotationOffset: batchNumber,
        includeTagLine,
        providerMode: aiStorageConfig.providerMode,
        providerType: aiStorageConfig.providerType,
        apiKey: configuredApiKeys.length > 0
          ? configuredApiKeys[batchNumber % configuredApiKeys.length]
          : aiStorageConfig.apiKey,
        baseUrl: aiStorageConfig.baseUrl,
        model: aiStorageConfig.model,
        density: aiStorageConfig.density,
        localBaseUrl: aiStorageConfig.localBaseUrl,
        localModel: aiStorageConfig.localModel,
        localApiKey: aiStorageConfig.localApiKey,
      };

      if (isDeepCut) {
        if (!batch.every(isDeepCutChunk)) {
          throw new Error('Deep cut mode received a mixed article pool.');
        }

        apiBody.preScrapedText = batch.map((item) => item.textChunk).join('\n\n');
        apiBody.singleTitle = batch[0]?.title ?? 'Custom Source';
      } else {
        if (!batch.every(isSearchArticle)) {
          throw new Error('Search mode received a mixed article pool.');
        }

        apiBody.articles = batch;
      }

      const genRes = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(apiBody),
        signal: huntAbortControllerRef.current?.signal,
      });

      if (!genRes.ok) {
        const errorText = await genRes.text();
        let parsedError: GenerateResponse | null = null;
        try {
          parsedError = JSON.parse(errorText) as GenerateResponse;
        } catch {
          parsedError = null;
        }

        if (parsedError) {
          const enrichedError = new Error(parsedError.error || 'Generation failed.') as Error & {
            code?: string;
          };
          enrichedError.code = parsedError.code;
          throw enrichedError;
        }

        throw new Error(`Generation failed: ${errorText}`);
      } else {
        const genData = (await genRes.json()) as GenerateResponse;
        if (genData.error) {
          throw new Error(genData.error);
        }

        if (Array.isArray(genData.candidates) && genData.candidates.length > 0) {
          const safeCandidates: RenderedCandidateCard[] = genData.candidates
            .filter((candidate): candidate is CandidateApiCard => isUsableCard(candidate))
            .map((candidate) => ({
              ...candidate,
              _rawTarget: targetLookup.get(candidate.targetId) ?? null,
              _runSignature: runSignature,
            }));
          setCandidateCards((prev) => mergeUniqueCards(prev, safeCandidates));
        }

        batchRawCards = genData.debug?.rawCards ?? 0;
        batchStrictCards = genData.debug?.strictCards ?? 0;
        batchFallbackCards = genData.debug?.fallbackCards ?? 0;
        batchRescueCards = genData.debug?.rescueCards ?? 0;

        if (Array.isArray(genData.cards)) {
          const safeCardsToAppend: RenderedCard[] = [];

          genData.cards
            .filter((card): card is GeneratedApiCard => isUsableCard(card))
            .forEach((card) => {
              const target = remainingTargets.find((candidate) => candidate.id === card.targetId);
              if (target && target.cardsNeeded > 0) {
                safeCardsToAppend.push({
                  ...card,
                  _rawTarget: { ...target },
                  _runSignature: runSignature,
                });
                target.cardsNeeded -= 1;
              }
            });

          if (safeCardsToAppend.length > 0) {
            batchAcceptedCount = safeCardsToAppend.length;
            appendedCount += safeCardsToAppend.length;
            setCards((prev) => orderCardsByContentionField(mergeUniqueCards(prev, safeCardsToAppend)));
          }

          remainingTargets = remainingTargets.filter((target) => target.cardsNeeded > 0);
        }

        if (!isDeepCut && batch.every(isSearchArticle)) {
          rememberCheckedHostsForTargets(
            topic,
            batchTargets,
            batch.map((item) => item.url)
          );
          checkedSiteMemoryUpdated = true;
        }
      }

      setHuntSummary((prev) => ({
        batchesScanned: (prev?.batchesScanned ?? 0) + 1,
        sourcesScanned: (prev?.sourcesScanned ?? 0) + batch.length,
        acceptedCards: (prev?.acceptedCards ?? 0) + batchAcceptedCount,
        rawCards: (prev?.rawCards ?? 0) + batchRawCards,
        strictCards: (prev?.strictCards ?? 0) + batchStrictCards,
        fallbackCards: (prev?.fallbackCards ?? 0) + batchFallbackCards,
        rescueCards: (prev?.rescueCards ?? 0) + batchRescueCards,
      }));
      batchesScanned += 1;
      sourcesScanned += batch.length;
      rawCards += batchRawCards;
      strictCards += batchStrictCards;
      fallbackCards += batchFallbackCards;
      rescueCards += batchRescueCards;

      if (batchAcceptedCount > 0) {
        successfulBatchesSinceCooldown += 1;
      }

      articleIndex += 1;

      if (remainingTargets.length > 0 && articleIndex < pool.length) {
        if (batchAcceptedCount === 0) {
          setStatusMsg(
            batchRawCards > 0
              ? `Batch ${batchNumber + 1}: model found ${batchRawCards} candidate cards, but kept 0 after validation. Continuing immediately to the next sources...`
              : `Batch ${batchNumber + 1}: model found no usable card candidates. Continuing immediately to the next sources...`
          );
          continue;
        }

        if (groqApiKeySlotCount > 1 && successfulBatchesSinceCooldown < groqApiKeySlotCount) {
          setStatusMsg(
            `Accepted cards in batch ${batchNumber + 1}. Rotating to the next Groq key immediately (${successfulBatchesSinceCooldown}/${groqApiKeySlotCount} key slots used this cycle)...`
          );
          continue;
        }

        setStatusMsg(
          `Waiting 60 seconds for Groq Cooldown. Remaining: (${remainingTargets.length} targets active)...`
        );
        for (let s = 60; s > 0; s -= 1) {
          throwIfHuntStopped();
          setCountdown(s);
          await sleepWithStopCheck(1000);
        }
        setCountdown(0);
        successfulBatchesSinceCooldown = 0;
      }
    }

    if (checkedSiteMemoryUpdated) {
      refreshCheckedSiteStats();
    }

    return {
      nextIndex: articleIndex,
      appendedCount,
      remainingTargets,
      summary: {
        batchesScanned,
        sourcesScanned,
        acceptedCards: appendedCount,
        rawCards,
        strictCards,
        fallbackCards,
        rescueCards,
      } satisfies HuntSummary,
    };
  };

  const updateCardTagline = (cardId: string, nextTag: string) => {
    setCards((prev) =>
      prev.map((card) => (card.id === cardId ? { ...card, tag: nextTag } : card))
    );
    setCandidateCards((prev) =>
      prev.map((card) => (card.id === cardId ? { ...card, tag: nextTag } : card))
    );
  };

  const updateCardQualityRating = (cardId: string, qualityRating: CardQualityRating) => {
    setCards((prev) =>
      prev.map((card) => (card.id === cardId ? { ...card, qualityRating } : card))
    );
    setCandidateCards((prev) =>
      prev.map((card) => (card.id === cardId ? { ...card, qualityRating } : card))
    );
  };

  const requestCardRanking = async (
    card: CardData & { _rawTarget?: HydratedTarget | null }
  ): Promise<CardQualityRating> => {
    const response = await fetch('/api/ranking', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        topic,
        contention: card.contention,
        targetText: card._rawTarget?.text,
        targetMode: card._rawTarget?.mode,
        targetSide: card._rawTarget?.side,
        type: card.type,
        tag: card.tag,
        citation: card.citation,
        bodyHtml: card.bodyHtml,
        reasoning: card.reasoning,
        ...getAiConfigFromStorage('planner'),
      }),
    });

    if (!response.ok) {
      throw new Error(await getResponseErrorMessage(response, 'Card ranking failed.'));
    }

    const data = (await response.json()) as RankingResponse;
    if (!data.rating || !Number.isFinite(data.rating.score)) {
      throw new Error(data.error || 'No card ranking was generated.');
    }

    return {
      score: Math.min(10, Math.max(1, Math.round(data.rating.score))),
      label: data.rating.label.trim() || 'Ranked card',
      rationale: data.rating.rationale.trim(),
    };
  };

  const handleGenerateTagline = async (
    card: CardData & { _rawTarget?: HydratedTarget | null }
  ) => {
    if (taglineLoadingIds[card.id]) {
      return;
    }

    setTaglineLoadingIds((prev) => ({ ...prev, [card.id]: true }));

    try {
      const response = await fetch('/api/tagline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic,
          contention: card.contention,
          targetText: card._rawTarget?.text,
          targetMode: card._rawTarget?.mode,
          targetSide: card._rawTarget?.side,
          type: card.type,
          citation: card.citation,
          bodyHtml: card.bodyHtml,
          reasoning: card.reasoning,
          ...getAiConfigFromStorage('planner'),
        }),
      });

      if (!response.ok) {
        throw new Error(
          await getResponseErrorMessage(response, 'Tag line generation failed.')
        );
      }

      const data = (await response.json()) as TaglineResponse;
      if (!data.tag?.trim()) {
        throw new Error(data.error || 'No tag line was generated.');
      }

      updateCardTagline(card.id, data.tag.trim());
    } catch (generationError) {
      const message = getErrorMessage(
        generationError,
        'Tag line generation failed. Please try again.'
      );
      setError(message);
    } finally {
      setTaglineLoadingIds((prev) => {
        const next = { ...prev };
        delete next[card.id];
        return next;
      });
    }
  };

  const handleGenerateRanking = async (
    card: CardData & { _rawTarget?: HydratedTarget | null }
  ): Promise<CardQualityRating | null> => {
    if (rankingLoadingIds[card.id]) {
      return card.qualityRating ?? null;
    }

    setRankingLoadingIds((prev) => ({ ...prev, [card.id]: true }));

    try {
      const qualityRating = await requestCardRanking(card);
      updateCardQualityRating(card.id, qualityRating);
      return qualityRating;
    } catch (rankingError) {
      const message = getErrorMessage(
        rankingError,
        'Card ranking failed. Please try again.'
      );
      setError(message);
      return null;
    } finally {
      setRankingLoadingIds((prev) => {
        const next = { ...prev };
        delete next[card.id];
        return next;
      });
    }
  };

  const fetchSearchRound = async (
    activeTargets: HydratedTarget[],
    existingPool: ArticlePoolItem[],
    round: number
  ) => {
    const excludeUrls = existingPool.filter(isSearchArticle).map((item) => item.url);
    const excludeHosts = Array.from(
      new Set([
        ...existingPool
          .filter(isSearchArticle)
          .map((item) => getUrlHostname(item.url))
          .filter(Boolean),
        ...collectCheckedHostsForTargets(topic, activeTargets),
      ])
    );
    const searchRes = await fetch('/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        topic,
        targetHints: activeTargets.map((target) => target.text).slice(0, 3),
        targets: activeTargets.map((target) => ({
          text: target.text,
          side: target.side,
          mode: target.mode,
          uniqueness: target.uniqueness,
          link: target.link,
          impact: target.impact,
        })),
        excludeUrls,
        excludeHosts,
        round,
      }),
      signal: huntAbortControllerRef.current?.signal,
    });

    if (!searchRes.ok) {
      const message = await getResponseErrorMessage(
        searchRes,
        'Search provider was temporarily unavailable.'
      );
      throw new Error(`Search failed: ${message}`);
    }

    return (await searchRes.json()) as SearchResponse;
  };

  const fetchNextNonEmptySearchRound = async (
    activeTargets: HydratedTarget[],
    existingPool: ArticlePoolItem[],
    startingRound: number,
    phaseLabel: string
  ): Promise<SearchRoundOutcome> => {
    let round = startingRound;
    let attemptsWithoutResults = 0;
    let providerUnavailableRounds = 0;

    while (true) {
      throwIfHuntStopped();
      setStatusMsg(`${phaseLabel} Query round ${round + 1}...`);
      const searchData = await fetchSearchRound(activeTargets, existingPool, round);
      const results = searchData.results || [];
      const nextRound = searchData.nextRound ?? round + 1;

      if (results.length > 0) {
        return {
          searchData,
          results,
          nextRound,
          attemptsWithoutResults,
          providerUnavailable: false,
          providerUnavailableRounds,
        };
      }

      if (searchData.providerUnavailable) {
        providerUnavailableRounds += 1;
        const retryDelay =
          PROVIDER_RETRY_DELAYS_MS[
            Math.min(providerUnavailableRounds - 1, PROVIDER_RETRY_DELAYS_MS.length - 1)
          ];
        setStatusMsg(
          providerUnavailableRounds === 1
            ? 'Search providers are temporarily unavailable. Retrying with a fresh query angle...'
            : `Search providers are still unavailable after ${providerUnavailableRounds} retry round(s). Waiting ${Math.round(
                retryDelay / 1000
              )}s before trying another fresh query angle...`
        );
        round = nextRound;
        await sleepWithStopCheck(retryDelay);
        continue;
      }

      providerUnavailableRounds = 0;
      attemptsWithoutResults += 1;
      round = nextRound;
      setStatusMsg(
        attemptsWithoutResults === 1
          ? 'That search angle found no fresh sources. Trying another query angle...'
          : attemptsWithoutResults % SEARCH_PROGRESS_INTERVAL === 0
            ? `Still looking for fresh sources. Tried ${attemptsWithoutResults} additional query angles so far and will keep searching...`
            : `Still looking for fresh sources. Tried ${attemptsWithoutResults} additional query angles so far...`
      );
    }
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (isLoading) return;

    const currentRunSignature = buildRunSignature(
      topic,
      affContentions,
      negContentions,
      supportResponses,
      targetUrl,
      rebuttalSideMode,
      contentionFormat,
      prepMode
    );

    setError(null);
    setArticlePool([]);
    setPoolProgress({});
    setHuntSummary(null);
    setStatusMsg('Preparing evidence hunt without clearing existing cards...');

    if (!topic) {
      setError('Debate topic is required.');
      return;
    }

    const rawTargets: GenerationTarget[] = buildDraftTargets(
      affContentions,
      negContentions,
      supportResponses,
      rebuttalSideMode,
      contentionFormat,
      prepMode
    );

    if (rawTargets.length === 0) {
      if (rebuttalSideMode === 'aff') {
        setError('Please provide at least one Affirmative contention (or a targeted response).');
      } else if (rebuttalSideMode === 'neg') {
        setError('Please provide at least one Negative contention (or a targeted response).');
      } else {
        setError('You must provide at least one Affirmative, Negative, or Support target.');
      }
      return;
    }

    const existingAcceptedCounts = countAcceptedCardsByContentionForRun(cards, currentRunSignature);
    const preservedAcceptedCountForRun = cards.filter(
      (card) => card._runSignature === currentRunSignature
    ).length;
    const targets: HydratedTarget[] = rawTargets
      .map((target, idx) => {
        const contention = buildTargetContentionLabel(target);
        return {
          ...target,
          id: `target_${Date.now()}_${idx}`,
          cardsNeeded: Math.max(0, findUntilStopped ? cardCount : cardCount - (existingAcceptedCounts[contention] ?? 0)),
          contention,
        };
      })
      .filter((target) => target.cardsNeeded > 0);

    if (targets.length === 0) {
      setStatusMsg(
        `Existing cards already satisfy the requested quota for this hunt. Kept ${preservedAcceptedCountForRun} accepted card(s) on screen.`
      );
      return;
    }

    const huntController = beginHuntSession();
    setIsLoading(true);

    try {
      let pool: ArticlePoolItem[] = [];
      const targetUrls = parseTargetUrls(targetUrl);
      const isDeepCut = targetUrls.length > 0;
      let searchRound = 0;

      if (isDeepCut) {
        setStatusMsg(
          targetUrls.length === 1
            ? `Deep Cut Mode: Downloading target website (${targetUrls[0]})...`
            : `Deep Cut Mode: Downloading ${targetUrls.length} target websites...`
        );
        const chunkSize = 5000;
        let successfulScrapes = 0;
        const failedErrors: string[] = [];

        for (let uIdx = 0; uIdx < targetUrls.length; uIdx += 1) {
          throwIfHuntStopped();
          const currentUrl = targetUrls[uIdx];
          setStatusMsg(
            `Deep Cut Mode (${uIdx + 1}/${targetUrls.length}): Downloading ${currentUrl}...`
          );

          try {
            const scrapeRes = await fetch('/api/scrape', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ url: currentUrl }),
              signal: huntAbortControllerRef.current?.signal,
            });

            if (!scrapeRes.ok) {
              const errText = await scrapeRes.text();
              failedErrors.push(`${currentUrl}: ${errText || 'Scrape request failed'}`);
              continue;
            }

            const scrapeData = (await scrapeRes.json()) as ScrapeResponse;
            const fullText = scrapeData.text || '';
            if (fullText.length < 300) {
              failedErrors.push(
                `${currentUrl}: Did not contain enough text (${fullText.length} chars).`
              );
              continue;
            }

            successfulScrapes += 1;
            const pageTitle = scrapeData.title || currentUrl;
            for (let i = 0; i < fullText.length; i += chunkSize) {
              pool.push({
                textChunk: fullText.substring(i, i + chunkSize),
                title: pageTitle,
              });
            }
          } catch (scrapeErr) {
            throwIfHuntStopped();
            failedErrors.push(
              `${currentUrl}: ${scrapeErr instanceof Error ? scrapeErr.message : 'Scrape error'}`
            );
          }
        }

        if (pool.length === 0) {
          throw new Error(
            failedErrors.length > 0
              ? `Could not extract usable text from target URL(s):\n${failedErrors.join('\n')}`
              : 'Target URL(s) did not contain enough text to cut cards from.'
          );
        }

        setStatusMsg(
          `Deep Cut Mode: Downloaded ${successfulScrapes} of ${targetUrls.length} target website(s) into ${pool.length} chunk(s). Beginning card extraction...`
        );
      } else {
        const searchOutcome = await fetchNextNonEmptySearchRound(
          targets,
          [],
          searchRound,
          'Searching for the first source pool...'
        );
        pool = searchOutcome.results;
        searchRound = searchOutcome.nextRound;
        if (pool.length === 0) {
          setStatusMsg(
            searchOutcome.providerUnavailable
              ? `Search providers are temporarily unavailable after ${searchOutcome.providerUnavailableRounds} retry round(s). Please try again in a moment.`
              : `Search exhausted ${searchOutcome.attemptsWithoutResults} query angles without finding a usable source pool for these claims.`
          );
          return;
        }
      }

      setArticlePool(pool);
      let nextIndex = 0;
      let pendingTargets = targets;
      let totalSummary = createEmptyHuntSummary();
      let lastDeepCutCycleAccepted = 0;
      let completedUntilStoppedCycles = 0;

      while (pendingTargets.length > 0) {
        throwIfHuntStopped();
        const batchResult = await processArticleBatches(
          pendingTargets,
          pool,
          nextIndex,
          isDeepCut,
          currentRunSignature
        );
        nextIndex = batchResult.nextIndex;
        pendingTargets = batchResult.remainingTargets;
        totalSummary = mergeHuntSummaries(totalSummary, batchResult.summary);
        setHuntSummary(totalSummary);

        if (pendingTargets.length === 0) {
          if (!findUntilStopped) break;
          if (isDeepCut && totalSummary.acceptedCards <= lastDeepCutCycleAccepted) {
            setStatusMsg('No new cards found in the latest source pass. Hunt stopped; saved cards are below.');
            break;
          }
          lastDeepCutCycleAccepted = totalSummary.acceptedCards;
          pendingTargets = rawTargets.map((target, idx) => ({
            ...target,
            id: `target_${Date.now()}_${completedUntilStoppedCycles}_${idx}`,
            cardsNeeded: cardCount,
            contention: buildTargetContentionLabel(target),
          }));
          completedUntilStoppedCycles += 1;
          if (isDeepCut) nextIndex = 0;
          continue;
        }

        if (isDeepCut) {
          if (!findUntilStopped) break;
          if (nextIndex < pool.length) continue;
          if (totalSummary.acceptedCards <= lastDeepCutCycleAccepted) {
            setStatusMsg('No new cards found in the latest source pass. Hunt stopped; saved cards are below.');
            break;
          }
          lastDeepCutCycleAccepted = totalSummary.acceptedCards;
          nextIndex = 0;
          continue;
        }

        if (nextIndex < pool.length) {
          continue;
        }

        const missingCardCount = pendingTargets.reduce(
          (sum, target) => sum + target.cardsNeeded,
          0
        );
        const searchOutcome = await fetchNextNonEmptySearchRound(
          pendingTargets,
          pool,
          searchRound,
          `Need ${missingCardCount} more card(s). Searching for a fresh source pool...`
        );
        searchRound = searchOutcome.nextRound;
        if (searchOutcome.providerUnavailable && searchOutcome.results.length === 0) {
          setStatusMsg(
            `Partial completion: kept ${totalSummary.acceptedCards} cards after scanning ${totalSummary.sourcesScanned} sources, but search providers became temporarily unavailable while trying to find ${missingCardCount} more card(s).`
          );
          break;
        }
        const nextResults = searchOutcome.results;

        pool = [...pool, ...nextResults];
        setArticlePool(pool);
      }

      setPoolProgress({ global: nextIndex });
      const totalAcceptedCountForRun = preservedAcceptedCountForRun + totalSummary.acceptedCards;
      if (totalSummary.acceptedCards === 0) {
        setStatusMsg(
          totalSummary.rawCards > 0
            ? `Finished scanning ${totalSummary.sourcesScanned} sources across ${totalSummary.batchesScanned} batches. The model produced ${totalSummary.rawCards} candidate cards, but kept 0 new accepted cards. ${preservedAcceptedCountForRun} accepted card(s) from this hunt were already preserved on screen.`
            : `Finished scanning ${totalSummary.sourcesScanned} sources across ${totalSummary.batchesScanned} batches. The model did not produce any new card candidates. ${preservedAcceptedCountForRun} accepted card(s) from this hunt were already preserved on screen.`
        );
      } else if (pendingTargets.length === 0) {
        setStatusMsg(
          `Generation complete: found all requested cards. Added ${totalSummary.acceptedCards} new card(s) after scanning ${totalSummary.sourcesScanned} sources, for ${totalAcceptedCountForRun} total accepted card(s) in this hunt.`
        );
      } else {
        setStatusMsg(
          `Partial completion: added ${totalSummary.acceptedCards} new card(s) after scanning ${totalSummary.sourcesScanned} sources, for ${totalAcceptedCountForRun} total accepted card(s) in this hunt, but ${pendingTargets.reduce(
            (sum, target) => sum + target.cardsNeeded,
            0
          )} requested card(s) are still missing.`
        );
      }
    } catch (submissionError: unknown) {
      const message = getErrorMessage(submissionError, 'Unknown error occurred.');
      const errorCode = getErrorCode(submissionError);
      if (errorCode === HUNT_STOPPED_ERROR_CODE) {
        setError(null);
        setStatusMsg('Evidence hunt stopped by you. Any cards already found were kept below.');
        return;
      }
      if (isAbortError(submissionError)) {
        setError('The browser or network interrupted the evidence request before it finished. Partial results were preserved; retry the hunt to continue.');
        setStatusMsg(
          hasVisibleResults
            ? 'Evidence hunt was interrupted by the browser or network. Partial results were preserved below.'
            : 'Evidence hunt was interrupted before a card was returned. Retry to continue.'
        );
        return;
      }
      setError(message);
      setStatusMsg(
        errorCode === 'API_KEYS_OVERUSED'
          ? 'Evidence hunt stopped because all available Groq keys appear rate-limited or unavailable.'
          : hasVisibleResults
            ? 'Evidence hunt stopped because of an error. Partial results are still available below.'
            : 'Evidence hunt stopped because of an error.'
      );
    } finally {
      clearHuntSession(huntController);
      setIsLoading(false);
      setCountdown(0);
    }
  };

  const handleReroll = async (contentionKey: string, target: HydratedTarget) => {
    if (isLoading) return;
    if (articlePool.length === 0) {
      setError('Article pool is empty. Please run a main search first.');
      return;
    }

    const huntController = beginHuntSession();
    setIsLoading(true);
    setError(null);
    setHuntSummary(null);
    setStatusMsg('Preparing reroll hunt...');

    const currentRunSignature = buildRunSignature(
      topic,
      affContentions,
      negContentions,
      supportResponses,
      targetUrl,
      rebuttalSideMode,
      contentionFormat,
      prepMode
    );
    const feedback = feedbacks[contentionKey] || '';
    const isDeepCut = articlePool[0] ? isDeepCutChunk(articlePool[0]) : false;
    const resumeIndex = poolProgress.global || 0;

    try {
      const mappedTarget: HydratedTarget = {
        ...target,
        id: `reroll_${Date.now()}`,
        cardsNeeded: cardCount,
        contention: contentionKey,
        feedback,
      };

      const { nextIndex, appendedCount, summary } = await processArticleBatches(
        [mappedTarget],
        articlePool,
        resumeIndex,
        isDeepCut,
        currentRunSignature
      );
      setHuntSummary(summary);

      setPoolProgress({ global: nextIndex });
      setStatusMsg(
        appendedCount > 0
          ? `Appended ${summary.acceptedCards} new card(s) after scanning ${summary.sourcesScanned} sources.`
          : summary.rawCards > 0
            ? `Reroll scanned ${summary.sourcesScanned} sources and found ${summary.rawCards} candidate cards, but none survived validation.`
            : `Reroll scanned ${summary.sourcesScanned} sources and found no candidate cards.`
      );
      setFeedbacks((prev) => ({ ...prev, [contentionKey]: '' }));
    } catch (rerollError: unknown) {
      const message = getErrorMessage(rerollError, 'Error occurred during reroll.');
      const errorCode = getErrorCode(rerollError);
      if (errorCode === HUNT_STOPPED_ERROR_CODE) {
        setError(null);
        setStatusMsg('Reroll stopped by you. Any cards already found were kept below.');
        return;
      }
      if (isAbortError(rerollError)) {
        setError('The browser or network interrupted the reroll request before it finished. Retry the reroll to continue.');
        setStatusMsg('Reroll was interrupted by the browser or network. Any partial results were preserved.');
        return;
      }
      setError(message);
      if (errorCode === 'API_KEYS_OVERUSED') {
        setStatusMsg('Reroll stopped because all available Groq keys appear rate-limited or unavailable.');
      }
    } finally {
      clearHuntSession(huntController);
      setIsLoading(false);
      setCountdown(0);
      setTimeout(() => setStatusMsg(''), 3000);
    }
  };

  const handleClearCheckedSiteMemory = () => {
    clearCheckedSiteMemory();
    refreshCheckedSiteStats();
    setStatusMsg(
      'Checked-site memory wiped. Future hunts can revisit websites that were previously skipped for these contentions.'
    );
  };

  const handleAddAffContention = () => {
    setAffContentions((prev) => [...prev, createNewContentionInput('aff')]);
  };

  const handleAddNegContention = () => {
    setNegContentions((prev) => [...prev, createNewContentionInput('neg')]);
  };

  const handleUpdateAffContention = (id: string, field: ContentionField, value: string) => {
    setAffContentions((prev) => updateContentionInput(prev, id, field, value));
  };

  const handleUpdateNegContention = (id: string, field: ContentionField, value: string) => {
    setNegContentions((prev) => updateContentionInput(prev, id, field, value));
  };

  const handleRemoveAffContention = (id: string) => {
    setAffContentions((prev) => removeContentionInput(prev, id, 'aff'));
  };

  const handleRemoveNegContention = (id: string) => {
    setNegContentions((prev) => removeContentionInput(prev, id, 'neg'));
  };

  const handleContentionFormatChange = (newFormat: ContentionFormat) => {
    setContentionFormat(newFormat);
    if (newFormat === 'paragraph') {
      setAffContentions((prev) =>
        prev.map((c) => {
          if (!c.paragraph?.trim()) {
            const parts = [
              c.uniqueness.trim() ? `Uniqueness: ${c.uniqueness.trim()}` : '',
              c.link.trim() ? `Link: ${c.link.trim()}` : '',
              c.impact.trim() ? `Impact: ${c.impact.trim()}` : '',
            ].filter(Boolean);
            if (parts.length > 0) {
              return { ...c, paragraph: parts.join('\n\n') };
            }
          }
          return c;
        })
      );
      setNegContentions((prev) =>
        prev.map((c) => {
          if (!c.paragraph?.trim()) {
            const parts = [
              c.uniqueness.trim() ? `Uniqueness: ${c.uniqueness.trim()}` : '',
              c.link.trim() ? `Link: ${c.link.trim()}` : '',
              c.impact.trim() ? `Impact: ${c.impact.trim()}` : '',
            ].filter(Boolean);
            if (parts.length > 0) {
              return { ...c, paragraph: parts.join('\n\n') };
            }
          }
          return c;
        })
      );
    } else {
      setAffContentions((prev) =>
        prev.map((c) => {
          if (!c.uniqueness.trim() && !c.link.trim() && !c.impact.trim() && c.paragraph?.trim()) {
            return { ...c, uniqueness: c.paragraph.trim() };
          }
          return c;
        })
      );
      setNegContentions((prev) =>
        prev.map((c) => {
          if (!c.uniqueness.trim() && !c.link.trim() && !c.impact.trim() && c.paragraph?.trim()) {
            return { ...c, uniqueness: c.paragraph.trim() };
          }
          return c;
        })
      );
    }
  };

  const handleDownloadResultsZip = () => {
    if (!hasVisibleResults) {
      setError('There are no results to download yet.');
      return;
    }

    try {
      const zipBlob = createZipBlob(
        buildResultsExportFiles({
          topic,
          acceptedCards: cards,
          reviewCards: candidateCards,
          huntSummary,
          statusMsg,
        })
      );
      const downloadUrl = URL.createObjectURL(zipBlob);
      const downloadLink = document.createElement('a');

      downloadLink.href = downloadUrl;
      downloadLink.download = `${sanitizeFilePart(topic, 'debate-card-results')}-results.zip`;
      document.body.appendChild(downloadLink);
      downloadLink.click();
      downloadLink.remove();
      window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
    } catch (downloadError) {
      setError(getErrorMessage(downloadError, 'Could not prepare the results zip.'));
    }
  };

  const handleCopyAllCards = async () => {
    if (cards.length === 0) {
      setError('There are no successful cards to copy yet.');
      return;
    }

    const orderedCards = orderCardsByContentionField(cards);
    const plainText = orderedCards
      .map((card, index) => renderCardText(card, 'Card', index))
      .join('\n\n');
    const htmlText = orderedCards
      .map((card, index) => renderCardHtmlFragment(card, 'Card', index))
      .join('\n');

    try {
      if (navigator.clipboard && window.ClipboardItem) {
        await navigator.clipboard.write([
          new ClipboardItem({
            'text/html': new Blob([htmlText], { type: 'text/html' }),
            'text/plain': new Blob([plainText], { type: 'text/plain' }),
          }),
        ]);
      } else {
        await navigator.clipboard.writeText(plainText);
      }
      setAllCopied(true);
      window.setTimeout(() => setAllCopied(false), 2000);
    } catch (copyError) {
      setError(getErrorMessage(copyError, 'Could not copy all cards.'));
    }
  };

  const handleSortSuccessfulCardsByRanking = async () => {
    if (isLoading || isSortingByRanking) {
      return;
    }

    if (cards.length === 0) {
      setError('There are no successful cards to sort yet.');
      return;
    }

    setIsSortingByRanking(true);
    setError(null);

    const ratingsByCardId = new Map(
      cards
        .filter((card) => card.qualityRating)
        .map((card) => [card.id, card.qualityRating as CardQualityRating])
    );

    try {
      for (let index = 0; index < cards.length; index += 1) {
        const card = cards[index];

        if (ratingsByCardId.has(card.id)) {
          continue;
        }

        setStatusMsg(`Ranking successful card ${index + 1} of ${cards.length} before sorting...`);
        setRankingLoadingIds((prev) => ({ ...prev, [card.id]: true }));

        try {
          const qualityRating = await requestCardRanking(card);
          ratingsByCardId.set(card.id, qualityRating);
          updateCardQualityRating(card.id, qualityRating);
        } finally {
          setRankingLoadingIds((prev) => {
            const next = { ...prev };
            delete next[card.id];
            return next;
          });
        }
      }

      setCards((prev) => {
        const originalIndex = new Map(
          prev.map((card, index) => [buildCardIdentityKey(card), index])
        );
        const contentionOrder = new Map<string, number>();

        prev.forEach((card) => {
          const key = card.contention || 'General Arguments';
          if (!contentionOrder.has(key)) {
            contentionOrder.set(key, contentionOrder.size);
          }
        });

        const cardsWithRankings = prev.map((card) => {
          const qualityRating = ratingsByCardId.get(card.id);
          return qualityRating ? { ...card, qualityRating } : card;
        });

        return cardsWithRankings.sort((a, b) => {
          const aContention = a.contention || 'General Arguments';
          const bContention = b.contention || 'General Arguments';
          const contentionDifference =
            (contentionOrder.get(aContention) ?? 0) - (contentionOrder.get(bContention) ?? 0);

          if (contentionDifference !== 0) {
            return contentionDifference;
          }

          const aScore = ratingsByCardId.get(a.id)?.score ?? a.qualityRating?.score ?? -1;
          const bScore = ratingsByCardId.get(b.id)?.score ?? b.qualityRating?.score ?? -1;
          const scoreDifference = bScore - aScore;

          if (scoreDifference !== 0) {
            return scoreDifference;
          }

          return (
            (originalIndex.get(buildCardIdentityKey(a)) ?? 0) -
            (originalIndex.get(buildCardIdentityKey(b)) ?? 0)
          );
        });
      });

      setStatusMsg(
        `Successful cards sorted by ranking. Cards are best-first within each contention.`
      );
    } catch (rankingError) {
      const message = getErrorMessage(
        rankingError,
        'Could not finish ranking and sorting successful cards.'
      );
      setError(message);
      setStatusMsg('Ranking sort stopped. Any rankings already generated were kept.');
    } finally {
      setIsSortingByRanking(false);
    }
  };

  const groupedCards = cards.reduce<Record<string, GroupedCardsEntry>>((acc, card) => {
    const key = card.contention || 'General Arguments';
    if (!acc[key]) {
      acc[key] = { cards: [], target: card._rawTarget ?? null };
    }
    acc[key].cards.push(card);
    return acc;
  }, {});

  const groupedCandidateCards = candidateCards.reduce<Record<string, GroupedCandidateEntry>>(
    (acc, card) => {
      const key = card.contention || 'General Arguments';
      if (!acc[key]) {
        acc[key] = { cards: [], target: card._rawTarget ?? null };
      }
      acc[key].cards.push(card);
      return acc;
    },
    {}
  );

  const hasUnrankedSuccessfulCards = cards.some((card) => !card.qualityRating);
  const candidateAcceptedCount = candidateCards.filter((card) => card.status === 'accepted').length;
  const candidateRejectedCount = candidateCards.length - candidateAcceptedCount;

  return (
    <div
      className="debate-app"
      suppressHydrationWarning
    >
      <Navbar activeTab={activeTab} onTabChange={setActiveTab} />

      <AiEngineSelector />

      {activeTab === 'auto-carder' && (
        <AutoCarderTab
          onSendToRheotriciser={() => setActiveTab('rheotriciser')}
          onSendToRanker={(newCard) => {
            setCards((prev) => mergeUniqueCards(prev, [newCard as RenderedCard]));
            setActiveTab('ranker');
          }}
        />
      )}

      {activeTab === 'blox' && (
        <BloxTab
          onSendToRheotriciser={() => setActiveTab('rheotriciser')}
          onSendToRanker={(newCard) => {
            setCards((prev) => mergeUniqueCards(prev, [newCard as RenderedCard]));
            setActiveTab('ranker');
          }}
        />
      )}

      {activeTab === 'batch-cutter' && (
        <BatchCutterTab
          onSendToRheotriciser={() => setActiveTab('rheotriciser')}
          onSendToRanker={(newCard) => {
            setCards((prev) => mergeUniqueCards(prev, [newCard as RenderedCard]));
            setActiveTab('ranker');
          }}
        />
      )}

      {activeTab === 'library' && (
        <CardLibraryTab
          onSendToRheotriciser={() => setActiveTab('rheotriciser')}
          onSendToRanker={(newCard) => {
            setCards((prev) => mergeUniqueCards(prev, [newCard as RenderedCard]));
            setActiveTab('ranker');
          }}
        />
      )}

      {activeTab === 'depositories' && <CardDepositoriesTab />}
      {activeTab === 'contradictions' && <ContradictionFinderTab />}
      {activeTab === 'counter' && <OpponentCaseCounterTab />}
      {activeTab === 'rheotriciser' && <RheotriciserTab />}
      <div hidden={activeTab !== 'topic-cutter'}>
        <TopicCardCutterTab
          topic={topic}
          onCardsUpdate={(nextCards) =>
            setCards((previousCards) => mergeUniqueCards(previousCards, nextCards as RenderedCard[]))
          }
        />
      </div>
      <div hidden={activeTab !== 'evidence'}>
        <ContentionEvidenceTab
          topic={topic}
          onCardsUpdate={(nextCards) =>
            setCards((previousCards) => mergeUniqueCards(previousCards, nextCards as RenderedCard[]))
          }
        />
      </div>
      {activeTab === 'ranker' && (
        <CardRankerTab
          cards={cards}
          topic={topic}
          onCardsUpdate={(nextCards) => setCards(nextCards as RenderedCard[])}
        />
      )}

      {activeTab === 'generator' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <div className="card-box animate-fade-in" style={{ padding: 'clamp(1.2rem, 3.5vw, 2.2rem)' }}>
            <div style={{ marginBottom: '1.6rem' }}>
              <p style={{ margin: '0 0 0.35rem 0', fontFamily: 'var(--font-mono)', color: 'var(--muted-foreground)', fontSize: '0.72rem', fontWeight: 600, letterSpacing: '0.2em', textTransform: 'uppercase' }}>
                Auto Prepper · Autonomous Deep Hunter
              </p>
              <h2 style={{ fontSize: '1.85rem', fontWeight: 600, fontStyle: 'italic', marginBottom: '0.45rem', letterSpacing: '-0.02em' }}>
                Autonomous Prepper & Hunter
              </h2>
              <p style={{ color: 'var(--muted-foreground)', lineHeight: 1.55, margin: 0, fontSize: '0.92rem' }}>
                Enter your topic and contentions. The agent iteratively searches, scrapes full-text literature, cuts cards, and validates warrants through strict verification rounds.
              </p>
            </div>

        <form
          onSubmit={handleSubmit}
          style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}
        >
          <div style={{ display: 'flex', gap: '1rem' }}>
            <div style={{ flex: 1 }}>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>
                Debate Topic *
              </label>
              <input
                type="text"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="e.g. The US should eliminate the President's authority to deploy military forces abroad..."
                style={{
                  width: '100%',
                  padding: '0.8rem',
                  background: 'var(--input-bg)',
                  border: '1px solid var(--card-border)',
                  color: 'var(--foreground)',
                  borderRadius: '8px',
                }}
                disabled={isLoading}
              />
            </div>

            <div style={{ flex: 1 }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '0.5rem',
                  flexWrap: 'wrap',
                  gap: '0.5rem',
                }}
              >
                <label style={{ fontWeight: 'bold' }}>
                  Specific Target URLs (Optional)
                </label>
                {parsedTargetUrlsCount > 0 && (
                  <span
                    style={{
                      fontSize: '0.75rem',
                      padding: '0.15rem 0.55rem',
                      borderRadius: '999px',
                      background: 'var(--accent)',
                      color: 'var(--accent-foreground)',
                      border: '1px solid var(--border)',
                      fontWeight: 600,
                    }}
                  >
                    ✓ {parsedTargetUrlsCount} {parsedTargetUrlsCount === 1 ? 'URL' : 'URLs'} configured
                  </span>
                )}
              </div>
              <textarea
                value={targetUrl}
                onChange={(e) => setTargetUrl(e.target.value)}
                placeholder="Paste one or multiple URLs (one per line or comma-separated) to deep-cut specific websites instead of searching Google..."
                rows={3}
                style={{
                  width: '100%',
                  padding: '0.8rem',
                  background: 'var(--input-bg)',
                  border: '1px solid var(--card-border)',
                  color: 'var(--foreground)',
                  borderRadius: '8px',
                  resize: 'vertical',
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                  fontSize: '0.88rem',
                  lineHeight: 1.4,
                }}
                disabled={isLoading}
              />
            </div>
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>
              Genuine Cards Per Contention
            </label>
            <select
              value={findUntilStopped ? 'until-stopped' : String(cardCount)}
              onChange={(event) => {
                if (event.target.value === 'until-stopped') {
                  setFindUntilStopped(true);
                } else {
                  setFindUntilStopped(false);
                  setCardCount(Number(event.target.value));
                }
              }}
              style={{
                minWidth: '180px',
                padding: '0.8rem',
                background: 'var(--input-bg)',
                border: '1px solid var(--card-border)',
                color: 'var(--foreground)',
                borderRadius: '8px',
              }}
              disabled={isLoading}
            >
              {Array.from({ length: 20 }, (_, index) => index + 1).map((amount) => (
                <option key={amount} value={amount}>
                  {amount} card{amount === 1 ? '' : 's'}
                </option>
              ))}
              <option value="until-stopped">Until I stop</option>
            </select>
          </div>

          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
              padding: '0.9rem 1rem',
              background: 'var(--card)',
              border: '1px solid var(--card-border)',
              borderRadius: '8px',
              cursor: isLoading ? 'default' : 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={includeTagLine}
              onChange={(e) => setIncludeTagLine(e.target.checked)}
              disabled={isLoading}
            />
            <span style={{ color: 'var(--foreground)' }}>
              Include tag line
              <span style={{ color: 'var(--muted-foreground)', marginLeft: '0.5rem' }}>
                Turn this off to save some output tokens.
              </span>
            </span>
          </label>

          {/* Rebuttal/Defense Area Container */}
          <div
            style={{
              padding: '1.25rem',
              background: prepMode === 'defense' ? 'var(--accent)' : 'var(--card)',
              border: prepMode === 'defense' ? '1px solid rgba(16, 185, 129, 0.3)' : '1px solid var(--card-border)',
              borderRadius: '12px',
              display: 'flex',
              flexDirection: 'column',
              gap: '1.2rem',
              transition: 'all 0.25s ease',
            }}
          >
            {/* Area Header with Controls */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '1rem',
                borderBottom: '1px solid var(--border)',
                paddingBottom: '1rem',
              }}
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{ fontSize: '1.25rem' }}>{prepMode === 'defense' ? '🛡️' : '⚔️'}</span>
                  <h3 style={{ margin: 0, fontSize: '1.1rem', color: 'var(--foreground)', fontWeight: 'bold' }}>
                    {prepMode === 'defense'
                      ? 'Defense Area: Contentions to Defend'
                      : 'Rebuttal Area: Contentions to Attack'}
                  </h3>
                </div>
                <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.82rem', color: 'var(--muted-foreground)' }}>
                  {prepMode === 'defense'
                    ? 'Enter your own contentions to autonomously hunt defensive cards, frontline evidence, and answers to opponent attacks.'
                    : 'Enter opponent contentions to autonomously hunt refutations, links, and impact turns.'}
                </p>
              </div>

              {/* Strategy Mode, Side Mode Selector & Contention Format Slider */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem', flexWrap: 'wrap' }}>
                <PrepModeSelector
                  mode={prepMode}
                  onChange={setPrepMode}
                  disabled={isLoading}
                />
                <RebuttalSideSelector
                  mode={rebuttalSideMode}
                  onChange={setRebuttalSideMode}
                  disabled={isLoading}
                />
                <ContentionFormatSlider
                  format={contentionFormat}
                  onChange={handleContentionFormatChange}
                  disabled={isLoading}
                />
              </div>
            </div>

            {/* Contentions Columns */}
            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-start' }}>
              {(rebuttalSideMode === 'both' || rebuttalSideMode === 'aff') && (
                <ContentionEditor
                  title={
                    prepMode === 'defense'
                      ? 'Aff Contentions (We will hunt for AFF defense against responses)'
                      : 'Aff Contentions (We will hunt for NEG attacks)'
                  }
                  accentColor={prepMode === 'defense' ? 'rgb(52, 211, 153)' : 'rgb(248, 113, 113)'}
                  borderColor={prepMode === 'defense' ? 'rgba(52, 211, 153, 0.4)' : 'rgba(248, 113, 113, 0.4)'}
                  contentions={affContentions}
                  format={contentionFormat}
                  disabled={isLoading}
                  onAdd={handleAddAffContention}
                  onRemove={handleRemoveAffContention}
                  onUpdate={handleUpdateAffContention}
                />
              )}
              {(rebuttalSideMode === 'both' || rebuttalSideMode === 'neg') && (
                <ContentionEditor
                  title={
                    prepMode === 'defense'
                      ? 'Neg Contentions (We will hunt for NEG defense against responses)'
                      : 'Neg Contentions (We will hunt for AFF attacks)'
                  }
                  accentColor={prepMode === 'defense' ? 'rgb(56, 189, 248)' : 'rgb(96, 165, 250)'}
                  borderColor={prepMode === 'defense' ? 'rgba(56, 189, 248, 0.4)' : 'rgba(96, 165, 250, 0.4)'}
                  contentions={negContentions}
                  format={contentionFormat}
                  disabled={isLoading}
                  onAdd={handleAddNegContention}
                  onRemove={handleRemoveNegContention}
                  onUpdate={handleUpdateNegContention}
                />
              )}
            </div>
          </div>

          <div>
            <label
              style={{
                display: 'block',
                marginBottom: '0.5rem',
                fontWeight: 'bold',
                color: 'var(--primary)',
              }}
            >
              Targeted Responses (We will exclusively hunt for evidence to PROVE/SUPPORT these
              specific statements)
            </label>
            <textarea
              value={supportResponses}
              onChange={(e) => setSupportResponses(e.target.value)}
              placeholder="e.g. 'Deploying drones completely solves the backlash problem.' (AI will find evidence definitively proving this)"
              rows={3}
              style={{
                width: '100%',
                padding: '0.8rem',
                background: 'var(--input-bg)',
                border: '1px solid rgba(167, 139, 250, 0.4)',
                color: 'var(--foreground)',
                borderRadius: '8px',
                resize: 'vertical',
              }}
              disabled={isLoading}
            />
            <p
              style={{
                margin: '0.5rem 0 0 0',
                fontSize: '0.85rem',
                color: 'var(--muted-foreground)',
              }}
            >
              If you put anything here, the hunt focuses only on these targeted responses and
              ignores the affirmative and negative contention boxes for that run.
            </p>
          </div>

          <div
            style={{
              padding: '1rem',
              background: 'var(--card)',
              border: '1px solid var(--card-border)',
              borderRadius: '8px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: '1rem',
              flexWrap: 'wrap',
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              <strong style={{ color: 'var(--foreground)' }}>Checked-Site Memory</strong>
              <span style={{ color: 'var(--muted-foreground)', fontSize: '0.9rem' }}>
                Stored only in this browser. The hunter skips websites it has already checked for
                the same topic and contention.
              </span>
              <span style={{ color: 'var(--muted-foreground)', fontSize: '0.9rem' }}>
                {checkedSiteStats.matchingSites} sites match the current setup across{' '}
                {checkedSiteStats.trackedContentions} tracked contention(s). {checkedSiteStats.totalSites}{' '}
                sites stored overall.
              </span>
            </div>

            <button
              type="button"
              onClick={handleClearCheckedSiteMemory}
              disabled={isLoading || checkedSiteStats.totalSites === 0}
              style={{
                padding: '0.8rem 1rem',
                background: 'var(--secondary)',
                color: 'var(--destructive)',
                border: '1px solid var(--destructive)',
                borderRadius: '8px',
                fontWeight: 'bold',
                cursor:
                  isLoading || checkedSiteStats.totalSites === 0 ? 'not-allowed' : 'pointer',
                opacity: isLoading || checkedSiteStats.totalSites === 0 ? 0.6 : 1,
              }}
            >
              Wipe Checked-Site Memory
            </button>
          </div>

          <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem', flexWrap: 'wrap' }}>
            <button
              type="submit"
              disabled={isLoading}
              style={{
                flex: 1,
                minWidth: '260px',
                padding: '1rem',
                background:
                  prepMode === 'defense'
                    ? 'linear-gradient(135deg, #059669 0%, #10b981 100%)'
                    : 'var(--primary)',
                color: 'var(--primary-foreground)',
                border: 'none',
                borderRadius: '8px',
                fontSize: '1.1rem',
                fontWeight: 'bold',
                cursor: isLoading ? 'not-allowed' : 'pointer',
                transition: 'background 0.2s',
                opacity: isLoading ? 0.7 : 1,
                boxShadow:
                  prepMode === 'defense'
                    ? '0 4px 14px rgba(16, 185, 129, 0.3)'
                    : '0 4px 14px rgba(2, 132, 199, 0.3)',
              }}
            >
              {isLoading
                ? 'Agent is Hunting...'
                : prepMode === 'defense'
                  ? '🛡️ Hunt Defensive Cards'
                  : '⚡ Hunt Refutation Cards'}
            </button>
            {isLoading && (
              <button
                type="button"
                onClick={handleStopHunt}
                disabled={huntStopRequested}
                style={{
                  padding: '1rem 1.25rem',
                  background: 'var(--secondary)',
                  color: 'var(--destructive)',
                  border: '1px solid var(--destructive)',
                  borderRadius: '8px',
                  fontSize: '1rem',
                  fontWeight: 'bold',
                  cursor: huntStopRequested ? 'not-allowed' : 'pointer',
                  opacity: huntStopRequested ? 0.7 : 1,
                }}
              >
                {huntStopRequested ? 'Stopping...' : 'Stop Hunt'}
              </button>
            )}
          </div>
        </form>

        {(statusMsg || huntSummary) && (
          <div
            style={{
              padding: '1rem',
              marginTop: '1rem',
              background: isLoading ? 'var(--accent)' : 'var(--card)',
              border: `1px solid ${isLoading ? 'var(--primary)' : 'var(--card-border)'}`,
              color: 'var(--foreground)',
              borderRadius: '8px',
              textAlign: 'left',
            }}
          >
            {statusMsg && (
              <div>
                <strong>Status:</strong> {statusMsg}
              </div>
            )}
            {countdown > 0 && (
              <div
                style={{
                  fontSize: '2rem',
                  fontWeight: 'bold',
                  marginTop: '0.5rem',
                  color: 'var(--primary)',
                }}
              >
                {countdown}s
              </div>
            )}
            {huntSummary && (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                  gap: '0.75rem',
                  marginTop: '0.75rem',
                }}
              >
                <div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--muted-foreground)' }}>Batches</div>
                  <div style={{ fontWeight: 'bold' }}>{huntSummary.batchesScanned}</div>
                </div>
                <div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--muted-foreground)' }}>Sources</div>
                  <div style={{ fontWeight: 'bold' }}>{huntSummary.sourcesScanned}</div>
                </div>
                <div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--muted-foreground)' }}>Candidates</div>
                  <div style={{ fontWeight: 'bold' }}>{huntSummary.rawCards}</div>
                </div>
                <div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--muted-foreground)' }}>Accepted</div>
                  <div style={{ fontWeight: 'bold' }}>{huntSummary.acceptedCards}</div>
                </div>
                <div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--muted-foreground)' }}>Strict Pass</div>
                  <div style={{ fontWeight: 'bold' }}>{huntSummary.strictCards}</div>
                </div>
                <div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--muted-foreground)' }}>Fallback Pass</div>
                  <div style={{ fontWeight: 'bold' }}>{huntSummary.fallbackCards}</div>
                </div>
                <div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--muted-foreground)' }}>Rescue Pass</div>
                  <div style={{ fontWeight: 'bold' }}>{huntSummary.rescueCards}</div>
                </div>
              </div>
            )}
          </div>
        )}

        {error && (
          <div
            style={{
              padding: '1rem',
              marginTop: '1rem',
              background: 'color-mix(in oklch, var(--destructive) 10%, var(--card))',
              border: '1px solid var(--destructive)',
              color: 'var(--destructive)',
              borderRadius: '8px',
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <span>{error}</span>
              {hasVisibleResults && (
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '1rem',
                    flexWrap: 'wrap',
                  }}
                >
                  <span style={{ color: 'var(--destructive)' }}>
                    Partial results were preserved: {cards.length} successful, {candidateCards.length} candidate.
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      resultsSectionRef.current?.scrollIntoView({
                        behavior: 'smooth',
                        block: 'start',
                      })
                    }
                    style={{
                      padding: '0.55rem 0.9rem',
                      background: 'var(--secondary)',
                      border: '1px solid var(--border)',
                      borderRadius: '8px',
                      color: 'var(--foreground)',
                      cursor: 'pointer',
                      fontWeight: 'bold',
                    }}
                  >
                    Jump to Partial Results
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '3rem' }}>
        {(cards.length > 0 || candidateCards.length > 0) && (
          <div
            ref={resultsSectionRef}
            className="glass"
            style={{ padding: '2rem', borderRadius: '12px' }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '1rem',
                marginBottom: '0.75rem',
                flexWrap: 'wrap',
              }}
            >
              <h2
                style={{
                  fontSize: '1.5rem',
                  margin: 0,
                  color: 'var(--primary)',
                }}
              >
                Results
              </h2>
              <button
                type="button"
                onClick={handleDownloadResultsZip}
                disabled={!hasVisibleResults}
                style={{
                  padding: '0.7rem 1rem',
                  background: 'var(--accent)',
                  color: '#000',
                  border: 'none',
                  borderRadius: '8px',
                  fontWeight: 'bold',
                  cursor: hasVisibleResults ? 'pointer' : 'not-allowed',
                  opacity: hasVisibleResults ? 1 : 0.6,
                }}
              >
                Download Results ZIP
              </button>
              <button
                type="button"
                onClick={handleCopyAllCards}
                disabled={cards.length === 0}
                style={{
                  padding: '0.7rem 1rem',
                  background: 'rgba(99, 102, 241, 0.2)',
                  color: 'var(--primary-foreground)',
                  border: '1px solid var(--primary)',
                  borderRadius: '8px',
                  fontWeight: 'bold',
                  cursor: cards.length > 0 ? 'pointer' : 'not-allowed',
                  opacity: cards.length > 0 ? 1 : 0.6,
                }}
              >
                {allCopied ? '✓ Copied All' : 'Copy All Cards'}
              </button>
            </div>
            <p style={{ margin: 0, color: 'var(--muted-foreground)' }}>
              Successful cards count toward the hunt target. Candidate cards are visible for review
              only and do not reduce the number of cards still needed.
            </p>
            {error && (
              <p style={{ margin: '0.75rem 0 0 0', color: 'var(--destructive)' }}>
                The hunt stopped early, but everything collected before the error is still shown below.
              </p>
            )}
          </div>
        )}

        {cards.length > 0 && (
          <div className="glass" style={{ padding: '2rem', borderRadius: '12px' }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '1rem',
                marginBottom: '1rem',
                flexWrap: 'wrap',
              }}
            >
              <h2 style={{ fontSize: '1.5rem', margin: 0, color: 'var(--primary)' }}>
                Successful Cards
              </h2>
              <button
                type="button"
                onClick={() => {
                  void handleSortSuccessfulCardsByRanking();
                }}
                disabled={isLoading || isSortingByRanking || cards.length === 0}
                style={{
                  padding: '0.7rem 1rem',
                  background: 'rgba(16, 185, 129, 0.16)',
                  color: 'var(--primary)',
                  border: '1px solid var(--border)',
                  borderRadius: '8px',
                  fontWeight: 'bold',
                  cursor:
                    isLoading || isSortingByRanking || cards.length === 0
                      ? 'not-allowed'
                      : 'pointer',
                  opacity: isLoading || isSortingByRanking || cards.length === 0 ? 0.65 : 1,
                }}
              >
                {isSortingByRanking
                  ? 'Ranking Cards...'
                  : hasUnrankedSuccessfulCards
                    ? 'Rank & Sort Cards'
                    : 'Sort by Ranking'}
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '3rem' }}>
              {Object.entries(groupedCards).map(([contentionName, group]) => (
                <div key={contentionName}>
                  <h3
                    style={{
                      fontSize: '1.3rem',
                      borderBottom: '1px solid var(--card-border)',
                      paddingBottom: '0.5rem',
                      marginBottom: '1.5rem',
                      color: 'var(--primary)',
                    }}
                  >
                    {contentionName}
                  </h3>

                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '1.5rem',
                      marginBottom: '2rem',
                    }}
                  >
                    {group.cards.map((card, i) => {
                      const isGeneratingTagline = Boolean(taglineLoadingIds[card.id]);
                      const isGeneratingRanking = Boolean(rankingLoadingIds[card.id]);

                      return (
                        <div key={getRenderedCardKey(card, i, 'accepted')}>
                          <Card card={card} />
                          <div
                            style={{
                              display: 'flex',
                              justifyContent: 'flex-end',
                              gap: '0.75rem',
                              flexWrap: 'wrap',
                              marginTop: '-0.75rem',
                              marginBottom: '0.25rem',
                            }}
                          >
                            <button
                              onClick={() => {
                                void handleGenerateTagline(card);
                              }}
                              disabled={isLoading || isGeneratingTagline}
                              style={{
                                padding: '0.65rem 1rem',
                                background: 'var(--secondary)',
                                color: 'var(--foreground)',
                                border: '1px solid var(--border)',
                                borderRadius: '8px',
                                fontWeight: 'bold',
                                cursor:
                                  isLoading || isGeneratingTagline ? 'not-allowed' : 'pointer',
                                opacity: isLoading || isGeneratingTagline ? 0.65 : 1,
                              }}
                            >
                              {isGeneratingTagline
                                ? 'Generating Tag Line...'
                                : card.tag.trim()
                                  ? 'Regenerate Tag Line'
                                  : 'Generate Tag Line'}
                            </button>
                            <button
                              onClick={() => {
                                void handleGenerateRanking(card);
                              }}
                              disabled={isLoading || isGeneratingRanking}
                              style={{
                                padding: '0.65rem 1rem',
                                background: 'rgba(16, 185, 129, 0.12)',
                                color: 'var(--primary)',
                                border: '1px solid rgba(16, 185, 129, 0.35)',
                                borderRadius: '8px',
                                fontWeight: 'bold',
                                cursor:
                                  isLoading || isGeneratingRanking ? 'not-allowed' : 'pointer',
                                opacity: isLoading || isGeneratingRanking ? 0.65 : 1,
                              }}
                            >
                              {isGeneratingRanking
                                ? 'Generating Ranking...'
                                : card.qualityRating
                                  ? 'Regenerate Ranking'
                                  : 'Generate Ranking'}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {group.target && (
                    <div
                      style={{
                        background: 'var(--secondary)',
                        padding: '1.5rem',
                        borderRadius: '8px',
                        border: '1px solid var(--card-border)',
                      }}
                    >
                      <p
                        style={{
                          margin: '0 0 0.5rem 0',
                          fontWeight: 'bold',
                          color: 'var(--foreground)',
                        }}
                      >
                        Not satisfied? Give the AI feedback and Hunt for More.
                      </p>
                      <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                        <input
                          type="text"
                          placeholder="e.g. 'Make the tags punchier', 'Find evidence about Europe instead', 'Stop pulling UN logic'"
                          value={feedbacks[contentionName] || ''}
                          onChange={(e) =>
                            setFeedbacks((prev) => ({ ...prev, [contentionName]: e.target.value }))
                          }
                          style={{
                            flex: 1,
                            padding: '0.8rem',
                            background: 'var(--input-bg)',
                            border: '1px solid var(--card-border)',
                            color: 'var(--foreground)',
                            borderRadius: '8px',
                          }}
                          disabled={isLoading}
                        />
                        <button
                          onClick={() => {
                            if (group.target) {
                              void handleReroll(contentionName, group.target);
                            }
                          }}
                          disabled={isLoading}
                          style={{
                            padding: '0.8rem 1.5rem',
                            background: 'var(--accent)',
                            color: '#000',
                            border: 'none',
                            borderRadius: '8px',
                            fontWeight: 'bold',
                            cursor: isLoading ? 'not-allowed' : 'pointer',
                          }}
                        >
                          Find More Cards
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {candidateCards.length > 0 && (
          <div className="glass" style={{ padding: '2rem', borderRadius: '12px' }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: '1rem',
                alignItems: 'baseline',
                marginBottom: '1rem',
                flexWrap: 'wrap',
              }}
            >
              <h2 style={{ fontSize: '1.5rem', margin: 0, color: 'var(--foreground)' }}>All Candidate Cards</h2>
              <p style={{ margin: 0, color: 'var(--muted-foreground)' }}>
                {candidateCards.length} total, {candidateAcceptedCount} accepted, {candidateRejectedCount} rejected
              </p>
            </div>
            <p style={{ marginTop: 0, color: 'var(--muted-foreground)' }}>
              This is a read-only review lane. Candidates shown here never count toward the number of
              cards still needed unless they also appear in the successful section above.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '3rem' }}>
              {Object.entries(groupedCandidateCards).map(([contentionName, group]) => (
                <div key={`candidate_${contentionName}`}>
                  <h3
                    style={{
                      fontSize: '1.3rem',
                      borderBottom: '1px solid var(--card-border)',
                      paddingBottom: '0.5rem',
                      marginBottom: '1.5rem',
                      color: 'var(--primary)',
                    }}
                  >
                    {contentionName}
                  </h3>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                    {group.cards.map((card, i) => {
                      const isGeneratingTagline = Boolean(taglineLoadingIds[card.id]);
                      const isGeneratingRanking = Boolean(rankingLoadingIds[card.id]);

                      return (
                        <div
                          key={getRenderedCardKey(card, i, 'candidate')}
                          style={{
                            padding: '1rem',
                            borderRadius: '12px',
                            border: `1px solid ${
                              card.status === 'accepted' ? 'rgba(74, 222, 128, 0.5)' : 'rgba(248, 113, 113, 0.45)'
                            }`,
                            background:
                              card.status === 'accepted'
                                ? 'rgba(74, 222, 128, 0.08)'
                                : 'rgba(248, 113, 113, 0.08)',
                          }}
                        >
                          <div
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              gap: '1rem',
                              marginBottom: '0.75rem',
                              flexWrap: 'wrap',
                            }}
                          >
                            <span
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                padding: '0.35rem 0.7rem',
                                borderRadius: '999px',
                                fontSize: '0.85rem',
                                fontWeight: 'bold',
                                color: card.status === 'accepted' ? '#bbf7d0' : '#fecaca',
                                background:
                                  card.status === 'accepted'
                                    ? 'rgba(22, 163, 74, 0.25)'
                                    : 'rgba(220, 38, 38, 0.25)',
                              }}
                            >
                              {getCandidateStageLabel(card.validationStage)}
                            </span>
                            <span style={{ color: 'var(--muted-foreground)', fontSize: '0.9rem' }}>
                              {card.note}
                            </span>
                          </div>

                          <Card card={card} />
                          <div
                            style={{
                              display: 'flex',
                              justifyContent: 'flex-end',
                              gap: '0.75rem',
                              flexWrap: 'wrap',
                              marginTop: '-0.75rem',
                            }}
                          >
                            <button
                              onClick={() => {
                                void handleGenerateTagline(card);
                              }}
                              disabled={isLoading || isGeneratingTagline}
                              style={{
                                padding: '0.65rem 1rem',
                                background: 'var(--secondary)',
                                color: 'var(--foreground)',
                                border: '1px solid var(--border)',
                                borderRadius: '8px',
                                fontWeight: 'bold',
                                cursor:
                                  isLoading || isGeneratingTagline ? 'not-allowed' : 'pointer',
                                opacity: isLoading || isGeneratingTagline ? 0.65 : 1,
                              }}
                            >
                              {isGeneratingTagline
                                ? 'Generating Tag Line...'
                                : card.tag.trim()
                                  ? 'Regenerate Tag Line'
                                  : 'Generate Tag Line'}
                            </button>
                            <button
                              onClick={() => {
                                void handleGenerateRanking(card);
                              }}
                              disabled={isLoading || isGeneratingRanking}
                              style={{
                                padding: '0.65rem 1rem',
                                background: 'rgba(16, 185, 129, 0.12)',
                                color: 'var(--primary)',
                                border: '1px solid rgba(16, 185, 129, 0.35)',
                                borderRadius: '8px',
                                fontWeight: 'bold',
                                cursor:
                                  isLoading || isGeneratingRanking ? 'not-allowed' : 'pointer',
                                opacity: isLoading || isGeneratingRanking ? 0.65 : 1,
                              }}
                            >
                              {isGeneratingRanking
                                ? 'Generating Ranking...'
                                : card.qualityRating
                                  ? 'Regenerate Ranking'
                                  : 'Generate Ranking'}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        </div>
        </div>
      )}
    </div>
  );
}
