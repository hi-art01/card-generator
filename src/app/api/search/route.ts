import { NextResponse } from 'next/server';
import * as cheerio from 'cheerio';
import google from 'googlethis';
import { isBannedUrl } from '../../../lib/domainFilters';

type SearchTargetMode = 'Attack' | 'Support' | 'Defend';
type SearchProvider = 'duckduckgo' | 'google' | 'brave' | 'bing';
type ClaimHintRule = {
  triggers: string[];
  hints: string[];
};

interface SearchTargetHint {
  text: string;
  mode?: SearchTargetMode;
  uniqueness?: string;
  link?: string;
  impact?: string;
}

interface SearchRequestBody {
  topic?: string;
  targetHints?: string[];
  targets?: SearchTargetHint[];
  excludeUrls?: string[];
  excludeHosts?: string[];
  round?: number;
  limit?: number;
}

interface SearchResult {
  url: string;
  title: string;
}

interface ProviderSearchResult {
  provider: SearchProvider;
  results: SearchResult[];
}

const GENERIC_ANGLES = [
  'effectiveness study',
  'evidence analysis',
  'criticism study',
  'empirical research',
  'policy analysis',
  'impact study',
  'counterarguments research',
  'advantages disadvantages research',
  'solvency takeouts analysis',
  'turns and takeouts',
  'risk analysis',
  'literature review',
  'case study',
  'expert commentary',
  'journal article',
  'working paper',
  'report',
  'data analysis',
  'historical analysis',
  'evaluation study',
  'comparative analysis',
];

const ATTACK_ANGLES = [
  'criticism study',
  'failure analysis',
  'negative outcomes study',
  'backlash report',
  'drawbacks analysis',
  'ineffective policy study',
  'tradeoff analysis',
  'risk analysis',
  'unintended consequences research',
  'counterarguments research',
  'solvency takeouts analysis',
  'null findings study',
  'refutation',
  'failure case study',
];

const DEFENSE_ANGLES = [
  'answers criticism',
  'refutes objection',
  'counters concern',
  'effective despite',
  'defense of',
  'rebuts counterargument',
  'proves solvency',
  'backlash unfounded',
  'no risk of',
  'rebuttal analysis',
  'empirical defense',
  'frontline evidence',
];

const SEARCH_MODIFIERS = [
  '',
  'research',
  'study',
  'report',
  'data',
  'evidence',
  'policy',
  'debate',
  'case',
  'responses',
  'takeouts',
  'refutation',
];

const ATTACK_MODIFIERS = [
  '',
  'criticism',
  'counterarguments',
  'drawbacks',
  'backfire',
  'harms',
  'risks',
  'tradeoffs',
  'negative evidence',
  'no effect',
  'refutation',
];

const DEFENSE_MODIFIERS = [
  '',
  'rebuttal',
  'defense',
  'answers to criticism',
  'empirical proof',
  'effective',
  'solvency proven',
  'addresses concerns',
  'no backlash',
];

const SUPPORT_STANCES = [
  'evidence for',
  'benefits of',
  'effective',
  'improves',
  'reduces',
  'supports',
];

const ATTACK_STANCES = [
  'evidence against',
  'criticism of',
  'problems with',
  'fails',
  'ineffective',
  'backfires',
  'harms from',
];

const DEFENSE_STANCES = [
  'answers to',
  'defense of',
  'rebuttal to',
  'effective despite',
  'counters criticism of',
  'unfounded concerns about',
  'solves despite',
];

const DEFENSE_TAKEOUTS = [
  'answers criticism',
  'refutes objection',
  'counters counterargument',
  'unfounded concern',
  'no backlash',
  'effective despite',
  'circumvention impossible',
  'solves completely',
  'problem persists without it',
  'status quo failing',
];

const ATTACK_TAKEOUTS = [
  'non unique',
  'status quo solving',
  'already improving',
  'fails to solve',
  'does not reduce',
  'alternative solves better',
  'counterplan solves',
  'root cause elsewhere',
  'worsens the problem',
  'backfire',
  'tradeoff',
  'turn',
];
const SUPPORT_PROOF_TERMS = [
  'empirical support',
  'measurable benefits',
  'implementation success',
  'evidence of effectiveness',
  'improves outcomes',
  'solves the problem',
];
const PREVENTIVE_IMPACT_TERMS = /\b(stop|stops|stopped|prevent|prevents|prevented|avoid|avoids|avoided|avert|averts|averted|reduce|reduces|reduced|mitigat|curb|curbs|limit|limits|eliminat|eliminates)\w*\b/i;

const DOMAIN_FILTERS = ['', 'site:.gov', 'site:.edu', 'site:.org'];
const TRUSTED_EVIDENCE_HOSTS = [
  'reuters.com',
  'apnews.com',
  'brookings.edu',
  'cfr.org',
  'csis.org',
  'rand.org',
  'carnegieendowment.org',
  'cnas.org',
  'crsreports.congress.gov',
];
const INITIAL_TARGETED_ROUNDS = 2;
const INITIAL_TARGET_QUERY_LIMIT = 4;
const SEARCH_STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'by',
  'do',
  'does',
  'for',
  'from',
  'how',
  'if',
  'in',
  'into',
  'is',
  'it',
  'of',
  'on',
  'or',
  'should',
  'that',
  'the',
  'their',
  'there',
  'this',
  'to',
  'was',
  'were',
  'what',
  'when',
  'where',
  'which',
  'who',
  'will',
  'with',
]);
const SEARCH_NOISY_RELEVANCE_TERMS = new Set([
  'analysis',
  'arms',
  'benefits',
  'consequences',
  'costs',
  'data',
  'evidence',
  'government',
  'harms',
  'outcomes',
  'race',
  'report',
  'research',
  'risks',
  'statistics',
  'study',
  'united',
  'states',
]);
// Search sites frequently rate-limit or challenge automated requests. One
// short attempt is enough before the independent fallbacks take over; long
// serial retries made the UI look frozen for several minutes.
const DDG_TIMEOUT_MS = 6000;
const DDG_MAX_ATTEMPTS = 1;
const DDG_RETRY_DELAYS_MS = [400];
const FALLBACK_PROVIDER_TIMEOUT_MS = 6000;
const CLAIM_HINT_RULES: ClaimHintRule[] = [
  {
    triggers: ['congress', 'president', 'executive', 'court', 'constitution', 'constitutional', 'authority', 'legal'],
    hints: ['legal analysis', 'constitutional critique', 'separation of powers'],
  },
  {
    triggers: ['military', 'troops', 'deployment', 'deployments', 'war', 'defense', 'armed', 'security'],
    hints: ['war powers', 'military readiness', 'escalation risk'],
  },
  {
    triggers: ['economy', 'economic', 'tax', 'budget', 'spending', 'jobs', 'inflation', 'cost'],
    hints: ['economic costs', 'budget impact', 'cost overruns'],
  },
  {
    triggers: ['health', 'medical', 'hospital', 'insurance', 'medicare', 'medicaid', 'drug'],
    hints: ['health outcomes', 'implementation barriers', 'cost effectiveness'],
  },
  {
    triggers: ['climate', 'energy', 'carbon', 'emissions', 'electricity', 'oil', 'gas'],
    hints: ['emissions impact', 'energy reliability', 'consumer costs'],
  },
  {
    triggers: ['education', 'school', 'student', 'teacher', 'college', 'university'],
    hints: ['student outcomes', 'implementation barriers', 'program effectiveness'],
  },
];

function sanitizeHint(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function shortenHint(value: string): string {
  return sanitizeHint(value)
    .split(/\s+/)
    .slice(0, 10)
    .join(' ');
}

function keywordizeHint(value: string, maxWords = 6): string {
  return sanitizeHint(value)
    .replace(/[^a-zA-Z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => !SEARCH_STOP_WORDS.has(token.toLowerCase()))
    .slice(0, maxWords)
    .join(' ');
}

function buildSearchTargetText(target: SearchTargetHint): string {
  const structuredParts = [target.uniqueness, target.link, target.impact]
    .map((value) => sanitizeHint(value || ''))
    .filter(Boolean);

  return structuredParts.length > 0 ? structuredParts.join(' ') : sanitizeHint(target.text);
}

function buildSearchTargets(
  topic: string,
  targets: SearchTargetHint[] = [],
  targetHints: string[] = []
): SearchTargetHint[] {
  const normalizedTargets = targets
    .map<SearchTargetHint>((target) => ({
      text: buildSearchTargetText(target),
      mode: target.mode === 'Support' ? 'Support' : target.mode === 'Defend' ? 'Defend' : 'Attack',
      uniqueness: sanitizeHint(target.uniqueness || ''),
      link: sanitizeHint(target.link || ''),
      impact: sanitizeHint(target.impact || ''),
    }))
    .filter((target) => target.text);

  if (normalizedTargets.length > 0) {
    return normalizedTargets.slice(0, 6);
  }

  const normalizedHints = Array.from(new Set(targetHints.map(shortenHint).filter(Boolean))).map((text) => ({
    text,
    mode: 'Attack' as const,
  }));

  if (normalizedHints.length > 0) {
    return normalizedHints.slice(0, 6);
  }

  return [{ text: sanitizeHint(topic), mode: 'Attack' }];
}

function inferClaimContextHints(value: string): string[] {
  const normalizedValue = sanitizeHint(value).toLowerCase();
  const collectedHints = new Set<string>();

  CLAIM_HINT_RULES.forEach((rule) => {
    if (rule.triggers.some((trigger) => normalizedValue.includes(trigger))) {
      rule.hints.forEach((hint) => collectedHints.add(hint));
    }
  });

  return [...collectedHints];
}

function isPreventiveImpact(target: SearchTargetHint): boolean {
  return PREVENTIVE_IMPACT_TERMS.test(target.impact || target.text);
}

function buildInitialTargetedQueries(
  cleanedTopic: string,
  topicKeywords: string,
  targetPool: SearchTargetHint[],
  roundSeed: number
): string[] {
  const selectedTargets = targetPool.slice(0, INITIAL_TARGET_QUERY_LIMIT);

  return selectedTargets
    .flatMap((target, index) => {
      const exactHint = shortenHint(target.text) || cleanedTopic;
      const keywordHint = keywordizeHint(target.text, target.mode === 'Support' ? 8 : 6) || exactHint;
      const impactKeywordHint = keywordizeHint(target.impact || target.text, 8) || keywordHint;
      const compactHint = keywordizeHint(target.text, 4) || keywordHint;
      const topicContext = keywordizeHint(cleanedTopic, 4) || topicKeywords;
      const contextHints = inferClaimContextHints(target.text);
      const contextHint = contextHints[(roundSeed + index) % Math.max(contextHints.length, 1)] || '';
      const domainFilter =
        roundSeed === 0 ? '' : DOMAIN_FILTERS[(index + roundSeed) % DOMAIN_FILTERS.length];

      if (target.mode === 'Support') {
        const focusedQuery = isPreventiveImpact(target)
          ? `${impactKeywordHint} harms consequences risks costs ${topicContext} ${domainFilter}`
          : `${keywordHint} evidence for ${contextHint} ${topicContext} ${domainFilter}`;
        const sourceQuery = `${keywordHint} ${topicContext} ${roundSeed === 0 ? 'study report statistics research' : 'empirical analysis data'} ${domainFilter}`;
        const qualitySourceQuery = `${keywordHint} ${topicContext} ${roundSeed % 2 === 0 ? 'site:.org' : 'site:.edu'} research analysis`;
        const outcomeQuery = `${impactKeywordHint} outcomes effects benefits effectiveness ${topicContext} ${domainFilter}`;
        return [focusedQuery, sourceQuery, qualitySourceQuery, outcomeQuery].map(normalizeQuery);
      }

      if (target.mode === 'Defend') {
        const focusedQuery = normalizeQuery(
          roundSeed === 0
            ? index % 2 === 0
              ? `${keywordHint} answers criticism ${contextHint} ${topicKeywords} ${domainFilter}`
              : `${compactHint} effective despite objections ${contextHint} ${topicKeywords} ${domainFilter}`
            : index % 2 === 0
              ? `${keywordHint} refutes counterarguments ${contextHint} ${topicKeywords} ${domainFilter}`
              : `${keywordHint} defense against backlash ${contextHint} ${topicKeywords} ${domainFilter}`
        );
        const sourceQuery = normalizeQuery(
          `${keywordHint} ${topicKeywords} ${roundSeed === 0 ? 'empirical defense answers concerns' : 'rebuttal evidence study'} ${domainFilter}`
        );
        return [focusedQuery, sourceQuery];
      }

      const focusedQuery = normalizeQuery(
          roundSeed === 0
            ? index % 2 === 0
            ? `${keywordHint} criticism ${contextHint} ${topicKeywords} ${domainFilter}`
            : `${compactHint} evidence against ${contextHint} ${topicKeywords} ${domainFilter}`
          : index % 2 === 0
            ? `${keywordHint} drawbacks ${contextHint} ${topicKeywords} ${domainFilter}`
            : `${keywordHint} counterarguments ${contextHint} ${topicKeywords} ${domainFilter}`
      );
      const sourceQuery = normalizeQuery(`${keywordHint} ${topicKeywords} ${roundSeed === 0 ? 'study report data analysis' : 'empirical research failure'} ${domainFilter}`);
      return [focusedQuery, sourceQuery];
    })
    .filter(Boolean);
}

function buildRoundQueries(
  topic: string,
  targets: SearchTargetHint[],
  targetHints: string[],
  round: number
): string[] {
  const cleanedTopic = sanitizeHint(topic);
  const topicKeywords = keywordizeHint(cleanedTopic, 8) || cleanedTopic;
  const targetPool = buildSearchTargets(cleanedTopic, targets, targetHints);
  const roundSeed = Math.max(0, round);
  const roundFamily = Math.floor(roundSeed / 12);

  if (roundSeed < INITIAL_TARGETED_ROUNDS) {
    const focusedQueries = buildInitialTargetedQueries(
      cleanedTopic,
      topicKeywords,
      targetPool,
      roundSeed
    );
    if (focusedQueries.length > 0) {
      return Array.from(new Set(focusedQueries)).filter(Boolean);
    }
  }

  const queriesPerRound = 3;
  const queries: string[] = [];
  const roundTakeout = ATTACK_TAKEOUTS[roundSeed % ATTACK_TAKEOUTS.length];
  const roundDefenseTakeout = DEFENSE_TAKEOUTS[roundSeed % DEFENSE_TAKEOUTS.length];
  const roundSupportTerm = SUPPORT_PROOF_TERMS[roundSeed % SUPPORT_PROOF_TERMS.length];

  for (let offset = 0; offset < queriesPerRound; offset += 1) {
    const target = targetPool[(roundSeed + offset + roundFamily) % targetPool.length];
    const exactHint = shortenHint(target.text) || cleanedTopic;
    const keywordHint = keywordizeHint(target.text, target.mode === 'Support' || target.mode === 'Defend' ? 8 : 6) || exactHint;
    const compactHint = keywordizeHint(target.text, 4) || keywordHint;
    const contextHints = inferClaimContextHints(target.text);
    const contextHint =
      contextHints[(roundSeed + offset + roundFamily) % Math.max(contextHints.length, 1)] || '';
    const anglePool = target.mode === 'Support' ? GENERIC_ANGLES : target.mode === 'Defend' ? DEFENSE_ANGLES : ATTACK_ANGLES;
    const modifierPool = target.mode === 'Support' ? SEARCH_MODIFIERS : target.mode === 'Defend' ? DEFENSE_MODIFIERS : ATTACK_MODIFIERS;
    const stancePool = target.mode === 'Support' ? SUPPORT_STANCES : target.mode === 'Defend' ? DEFENSE_STANCES : ATTACK_STANCES;
    const angle = anglePool[(roundSeed * 2 + offset + roundFamily) % anglePool.length];
    const modifier = modifierPool[(roundSeed + offset * 3 + roundFamily) % modifierPool.length];
    const stance = stancePool[(roundSeed + offset * 5 + roundFamily) % stancePool.length];
    const domainFilter = DOMAIN_FILTERS[(Math.floor(roundSeed / 2) + offset + roundFamily) % DOMAIN_FILTERS.length];
    const style = (roundSeed + offset) % 5;

    let query = '';
    if (target.mode === 'Support') {
      switch (style) {
        case 0:
          query = `${cleanedTopic} "${exactHint}" ${angle} ${modifier} ${roundSupportTerm} ${domainFilter}`;
          break;
        case 1:
          query = `${keywordHint} ${stance} ${topicKeywords} ${contextHint} ${domainFilter}`;
          break;
        case 2:
          query = `${cleanedTopic} ${angle} ${keywordHint} ${modifier} ${roundSupportTerm} ${domainFilter}`;
          break;
        case 3:
          query = `"${exactHint}" ${topicKeywords} ${angle} ${contextHint} ${domainFilter}`;
          break;
        default:
          query = `${topicKeywords} ${keywordHint} ${angle} ${roundSupportTerm} ${domainFilter}`;
          break;
      }
    } else if (target.mode === 'Defend') {
      switch (style) {
        case 0:
          query = `${topicKeywords} ${keywordHint} ${angle} ${roundDefenseTakeout} ${contextHint} ${domainFilter}`;
          break;
        case 1:
          query = `${keywordHint} ${stance} ${topicKeywords} ${roundDefenseTakeout} ${domainFilter}`;
          break;
        case 2:
          query = `${topicKeywords} ${modifier} ${stance} ${keywordHint} ${contextHint} ${domainFilter}`;
          break;
        case 3:
          query = `${compactHint} ${angle} ${roundDefenseTakeout} ${topicKeywords} ${domainFilter}`;
          break;
        default:
          query = `${cleanedTopic} ${keywordHint} ${angle} ${roundDefenseTakeout} ${contextHint} ${domainFilter}`;
          break;
      }
    } else {
      switch (style) {
        case 0:
          query = `${topicKeywords} ${keywordHint} ${angle} ${roundTakeout} ${contextHint} ${domainFilter}`;
          break;
        case 1:
          query = `${keywordHint} ${stance} ${topicKeywords} ${roundTakeout} ${domainFilter}`;
          break;
        case 2:
          query = `${topicKeywords} ${modifier} ${stance} ${keywordHint} ${contextHint} ${domainFilter}`;
          break;
        case 3:
          query = `${compactHint} ${angle} ${roundTakeout} evidence against ${topicKeywords} ${domainFilter}`;
          break;
        default:
          query = `${cleanedTopic} ${keywordHint} ${angle} ${roundTakeout} ${contextHint} ${domainFilter}`;
          break;
      }
    }

    queries.push(normalizeQuery(query));
  }

  return Array.from(new Set(queries)).filter(Boolean);
}

function normalizeQuery(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function normalizeHostname(value: string): string {
  try {
    const parsed = new URL(value.startsWith('http') ? value : `https://${value}`);
    return parsed.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

function getEvidenceDomainScore(url: string): number {
  const hostname = normalizeHostname(url);
  if (!hostname) return 0;
  if (hostname.endsWith('.gov')) return 100;
  if (hostname.endsWith('.edu')) return 90;
  if (TRUSTED_EVIDENCE_HOSTS.some((trustedHost) => hostname === trustedHost || hostname.endsWith(`.${trustedHost}`))) {
    return 85;
  }
  if (hostname.endsWith('.org')) return 70;
  return 10;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function parseDuckDuckGoResults(ddgHtml: string): SearchResult[] {
  const $ddg = cheerio.load(ddgHtml);
  const searchResults: SearchResult[] = [];

  $ddg('.result').each((_, el) => {
    const titleLink = $ddg(el).find('.result__title a').first();
    const title = titleLink.text().trim() || $ddg(el).find('.result__title').text().trim();
    let link = titleLink.attr('href') || $ddg(el).find('.result__url').attr('href');
    if (link && link.includes('uddg=')) {
      const params = new URLSearchParams(link.split('?')[1] ?? '');
      link = params.get('uddg') || link;
    }
    if (link && !link.endsWith('.pdf') && !isBannedUrl(link)) {
      searchResults.push({ url: link, title });
    }
  });

  // DDG has changed its result container markup more than once. If the
  // legacy `.result` selector found nothing, use the stable result-title link
  // patterns and unwrap redirect URLs directly.
  if (searchResults.length === 0) {
    $ddg('a[data-testid="result-title-a"], a.result__a').each((_, el) => {
      const title = sanitizeHint($ddg(el).text());
      let link = $ddg(el).attr('href') || '';
      try {
        const parsedLink = new URL(link, 'https://duckduckgo.com');
        link = parsedLink.searchParams.get('uddg') || link;
      } catch {
        link = '';
      }

      if (title && link && !link.endsWith('.pdf') && !isBannedUrl(link) && !searchResults.some((result) => result.url === link)) {
        searchResults.push({ url: link, title });
      }
    });
  }

  return searchResults;
}

function unwrapDuckDuckGoUrl(rawUrl: string): string {
  try {
    const parsedUrl = new URL(rawUrl, 'https://duckduckgo.com');
    return parsedUrl.searchParams.get('uddg') || rawUrl;
  } catch {
    return rawUrl;
  }
}

function parseDuckDuckGoLiteResults(ddgHtml: string): SearchResult[] {
  const $ddg = cheerio.load(ddgHtml);
  const results: SearchResult[] = [];

  // Lite has a separate, intentionally simple markup format. It remains a
  // useful first-party DDG fallback when the normal HTML endpoint serves a
  // challenge page or changes its result selectors.
  $ddg('a.result-link, a[class*="result-link"]').each((_, element) => {
    const title = sanitizeHint($ddg(element).text());
    const url = unwrapDuckDuckGoUrl($ddg(element).attr('href') || '');
    if (
      title &&
      url &&
      !url.endsWith('.pdf') &&
      !isBannedUrl(url) &&
      !results.some((result) => result.url === url)
    ) {
      results.push({ url, title });
    }
  });

  return results;
}

async function fetchDuckDuckGoResults(query: string): Promise<SearchResult[]> {
  console.log(`Searching DuckDuckGo for: ${query}`);

  const ddgUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < DDG_MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DDG_TIMEOUT_MS);

    try {
      const ddgRes = await fetch(ddgUrl, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36',
        },
        signal: controller.signal,
      });

      if (!ddgRes.ok) {
        throw new Error(`DuckDuckGo returned ${ddgRes.status}`);
      }

      const ddgHtml = await ddgRes.text();
      return parseDuckDuckGoResults(ddgHtml);
    } catch (error) {
      lastError =
        error instanceof Error ? error : new Error('DuckDuckGo search request failed.');
      console.warn(
        `DuckDuckGo search attempt ${attempt + 1} failed for query "${query}".`,
        lastError
      );

      if (attempt < DDG_MAX_ATTEMPTS - 1) {
        await sleep(DDG_RETRY_DELAYS_MS[Math.min(attempt, DDG_RETRY_DELAYS_MS.length - 1)]);
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error(
    lastError?.name === 'AbortError'
      ? 'DuckDuckGo request timed out.'
      : lastError?.message || 'DuckDuckGo search request failed.'
  );
}

async function fetchDuckDuckGoLiteResults(query: string): Promise<SearchResult[]> {
  console.log(`Searching DuckDuckGo Lite fallback for: ${query}`);
  const liteUrl = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`;
  const response = await fetch(liteUrl, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml',
    },
    signal: AbortSignal.timeout(FALLBACK_PROVIDER_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`DuckDuckGo Lite returned ${response.status}`);
  }

  return parseDuckDuckGoLiteResults(await response.text());
}

async function fetchGoogleResults(query: string): Promise<SearchResult[]> {
  console.log(`Searching Google fallback for: ${query}`);

  const response = await google.search(query, {
    page: 0,
    safe: false,
    parse_ads: false,
    additional_params: {
      hl: 'en',
    },
  });

  const parsedResults = response.results
    .map((result) => ({
      url: result.url,
      title: sanitizeHint(result.title) || sanitizeHint(result.description) || result.url,
    }))
    .filter((result) => Boolean(result.url) && !result.url.endsWith('.pdf') && !isBannedUrl(result.url));

  if (parsedResults.length > 0) {
    return parsedResults;
  }

  // googlethis relies on selectors that Google changes periodically. Keep a
  // lightweight parser here so a successful Google response does not become
  // an empty source pool just because the package parser missed the markup.
  const googleUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&num=10&hl=en`;
  const googleResponse = await fetch(googleUrl, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml',
    },
    signal: AbortSignal.timeout(FALLBACK_PROVIDER_TIMEOUT_MS),
  });

  if (!googleResponse.ok) {
    throw new Error(`Google returned ${googleResponse.status}`);
  }

  const $google = cheerio.load(await googleResponse.text());
  const fallbackResults: SearchResult[] = [];
  $google('a').each((_, element) => {
    const title = sanitizeHint($google(element).find('h3').first().text());
    if (!title) return;

    const href = $google(element).attr('href') || '';
    let url = href;
    try {
      const parsedHref = new URL(href, 'https://www.google.com');
      if (parsedHref.pathname === '/url') {
        url = parsedHref.searchParams.get('q') || parsedHref.searchParams.get('url') || '';
      } else if (parsedHref.hostname === 'www.google.com' || parsedHref.hostname === 'google.com') {
        url = '';
      }
    } catch {
      url = '';
    }

    if (url && !url.endsWith('.pdf') && !isBannedUrl(url) && !fallbackResults.some((result) => result.url === url)) {
      fallbackResults.push({ url, title });
    }
  });

  return fallbackResults;
}

async function fetchBraveResults(query: string): Promise<SearchResult[]> {
  console.log(`Searching Brave fallback for: ${query}`);
  const braveUrl = `https://search.brave.com/search?q=${encodeURIComponent(query)}&source=web`;
  const response = await fetch(braveUrl, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml',
    },
    signal: AbortSignal.timeout(FALLBACK_PROVIDER_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Brave returned ${response.status}`);
  }

  const $brave = cheerio.load(await response.text());
  const results: SearchResult[] = [];
  $brave('a.heading-serpresult, #results .snippet-title a, [data-type="web"] a[href]').each((_, element) => {
    const title = sanitizeHint($brave(element).text());
    const url = $brave(element).attr('href') || '';
    if (
      title &&
      url.startsWith('http') &&
      !url.endsWith('.pdf') &&
      !isBannedUrl(url) &&
      !results.some((result) => result.url === url)
    ) {
      results.push({ url, title });
    }
  });

  return results;
}

async function fetchBingResults(query: string, allowSimplifiedRetry = true): Promise<SearchResult[]> {
  console.log(`Searching Bing fallback for: ${query}`);
  const bingUrl = `https://www.bing.com/search?q=${encodeURIComponent(query)}&count=10&setlang=en-US`;
  const response = await fetch(bingUrl, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml',
    },
    signal: AbortSignal.timeout(FALLBACK_PROVIDER_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Bing returned ${response.status}`);
  }

  const $bing = cheerio.load(await response.text());
  const results: SearchResult[] = [];
  $bing('li.b_algo h2 a').each((_, element) => {
    const title = sanitizeHint($bing(element).text());
    const rawUrl = $bing(element).attr('href') || '';
    let url = rawUrl;
    try {
      const parsedUrl = new URL(rawUrl);
      const encodedTarget = parsedUrl.searchParams.get('u');
      if (encodedTarget?.startsWith('a1')) {
        url = Buffer.from(encodedTarget.slice(2), 'base64url').toString('utf8');
      }
    } catch {
      url = rawUrl;
    }
    if (title && url && !url.endsWith('.pdf') && !isBannedUrl(url) && !results.some((result) => result.url === url)) {
      results.push({ url, title });
    }
  });

  const relevanceTerms = Array.from(
    new Set(
      query
        .toLowerCase()
        .split(/[^a-z0-9-]+/)
        .filter(
          (term) =>
            term.length >= 4 &&
            !SEARCH_STOP_WORDS.has(term) &&
            !SEARCH_NOISY_RELEVANCE_TERMS.has(term)
        )
    )
  );
  const relevantResults = results.filter((result) => {
    // Treat U.S.-China and US-China as the same term, then require more than
    // one meaningful match. This blocks generic SERP leftovers such as arms
    // stores while retaining sources that actually address the contention.
    const searchable = `${result.title} ${result.url}`.toLowerCase().replace(/[^a-z0-9]/g, '');
    const matchingTerms = relevanceTerms.filter((term) =>
      searchable.includes(term.replace(/[^a-z0-9]/g, ''))
    );
    const requiredMatches = relevanceTerms.length >= 3 ? 2 : 1;
    return matchingTerms.length >= requiredMatches;
  });

  if (relevantResults.length > 0) {
    return relevantResults;
  }

  const simplifiedQuery = Array.from(new Set(relevanceTerms)).slice(0, 6).join(' ');
  if (allowSimplifiedRetry && simplifiedQuery && simplifiedQuery !== query) {
    console.log(`Bing returned unrelated results for "${query}". Retrying with: ${simplifiedQuery}`);
    return fetchBingResults(simplifiedQuery, false);
  }

  // Never pass a search engine's generic fallback page to the evidence
  // reviewer. An empty source list is honest; unrelated results cause the
  // misleading "did not pass evidence review" outcome.
  return [];
}

async function fetchSearchResults(query: string): Promise<ProviderSearchResult> {
  try {
    const duckDuckGoResults = await fetchDuckDuckGoResults(query);
    if (duckDuckGoResults.length > 0) {
      return { provider: 'duckduckgo', results: duckDuckGoResults };
    }

    console.log(`DuckDuckGo returned 0 results for "${query}". Trying Google fallback.`);
  } catch (duckDuckGoError) {
    console.warn(`DuckDuckGo failed for "${query}". Trying Google fallback.`, duckDuckGoError);
  }

  try {
    const duckDuckGoLiteResults = await fetchDuckDuckGoLiteResults(query);
    if (duckDuckGoLiteResults.length > 0) {
      return { provider: 'duckduckgo', results: duckDuckGoLiteResults };
    }
    console.log(`DuckDuckGo Lite returned 0 results for "${query}". Trying Google fallback.`);
  } catch (duckDuckGoLiteError) {
    console.warn(`DuckDuckGo Lite failed for "${query}". Trying Google fallback.`, duckDuckGoLiteError);
  }

  try {
    const googleResults = await fetchGoogleResults(query);
    if (googleResults.length > 0) {
      return { provider: 'google', results: googleResults };
    }
    console.log(`Google returned 0 parsed results for "${query}". Trying Bing fallback.`);
  } catch (googleError) {
    console.warn(`Google failed for "${query}". Trying Bing fallback.`, googleError);
  }

  try {
    const braveResults = await fetchBraveResults(query);
    if (braveResults.length > 0) {
      return { provider: 'brave', results: braveResults };
    }
    console.log(`Brave returned 0 parsed results for "${query}". Trying Bing fallback.`);
  } catch (braveError) {
    console.warn(`Brave failed for "${query}". Trying Bing fallback.`, braveError);
  }

  const bingResults = await fetchBingResults(query);
  return { provider: 'bing', results: bingResults };
}

export async function POST(req: Request) {
  try {
    const {
      topic,
      targetHints = [],
      targets = [],
      excludeUrls = [],
      excludeHosts = [],
      round = 0,
      limit = 12,
    }: SearchRequestBody = await req.json();

    if (!topic) {
      return NextResponse.json({ error: 'Missing topic' }, { status: 400 });
    }

    const roundQueries = buildRoundQueries(topic, targets, targetHints, round);

    const blockedUrls = new Set(excludeUrls);
    const blockedHosts = new Set(excludeHosts.map((host) => normalizeHostname(host)).filter(Boolean));
    const dedupedResults = new Map<string, SearchResult>();
    let hadSuccessfulQuery = false;
    const providersUsed = new Set<SearchProvider>();
    const providerErrors: string[] = [];

    // Each query is independent. Running them together means a slow or
    // blocked provider delays one search round by seconds, not minutes.
    const queryAttempts = await Promise.all(
      roundQueries.map(async (query) => {
        try {
          return { query, result: await fetchSearchResults(query) } as const;
        } catch (error) {
          return { query, error } as const;
        }
      })
    );

    queryAttempts.forEach((attempt) => {
      if ('error' in attempt) {
        console.warn(`Search query failed and will be skipped: ${attempt.query}`, attempt.error);
        const message =
          attempt.error instanceof Error ? attempt.error.message : 'Unknown search provider failure.';
        providerErrors.push(`${attempt.query}: ${message}`);
        return;
      }

      const { provider, results } = attempt.result;
      hadSuccessfulQuery = true;
      providersUsed.add(provider);
      results.forEach((result) => {
        const hostname = normalizeHostname(result.url);
        if (
          !blockedUrls.has(result.url) &&
          (!hostname || !blockedHosts.has(hostname)) &&
          !dedupedResults.has(result.url)
        ) {
          dedupedResults.set(result.url, result);
        }
      });
    });

    if (!hadSuccessfulQuery) {
      return NextResponse.json(
        {
          results: [],
          exhausted: false,
          nextRound: round + 1,
          queriesUsed: roundQueries,
          providersUsed: [...providersUsed],
          providerUnavailable: true,
          providerErrors: providerErrors.slice(0, 6),
        }
      );
    }

    return NextResponse.json({
      results: [...dedupedResults.values()]
        .sort((left, right) => getEvidenceDomainScore(right.url) - getEvidenceDomainScore(left.url))
        .slice(0, limit),
      exhausted: false,
      nextRound: round + 1,
      queriesUsed: roundQueries,
      providersUsed: [...providersUsed],
    });
  } catch (error: unknown) {
    console.error(error);
    const message = error instanceof Error ? error.message : 'Unknown error occurred.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
