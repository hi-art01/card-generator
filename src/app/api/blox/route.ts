import { NextResponse } from 'next/server';
import * as cheerio from 'cheerio';
import google from 'googlethis';
import { runChatCompletionWithFallback, AiConfigOptions } from '../../../lib/aiProvider';
import { isBannedUrl } from '../../../lib/domainFilters';
import {
  formatSourceCitation,
  formatSourceGroundedCard,
  reviewSourceGroundedCards,
} from '../../../lib/sourceGroundedCards';

interface BloxRequest {
  argument: string;
  mode?: 'web' | 'custom' | 'synthesis';
  customSources?: string[];
  count?: number;
  cycle?: number;
  excludeCards?: string[];
  excludeUrls?: string[];
  density?: 'tech' | 'lay';
  providerMode?: 'cloud' | 'local' | 'auto';
  providerType?: 'auto' | 'grok' | 'openai' | 'groq' | 'openrouter' | 'deepseek' | 'custom' | 'local';
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  localBaseUrl?: string;
  localModel?: string;
  localApiKey?: string;
}

interface ScrapedWebResult {
  url: string;
  title: string;
  text: string;
  author?: string;
  authorQualifications?: string;
  publishedDate?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function normalizeSourceUrl(url: string): string {
  return url.toLowerCase().replace(/\/+$/, '');
}

async function scrapeSource(
  url: string,
  fallbackTitle = 'Research Source',
  signal?: AbortSignal
): Promise<ScrapedWebResult | null> {
  if (isBannedUrl(url)) return null;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      signal: AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(10000)]),
    });
    if (!res.ok) return null;

    const html = await res.text();
    const $ = cheerio.load(html);
    const title = $('meta[property="og:title"]').attr('content')?.trim() || $('title').text().trim() || fallbackTitle;
    const author = $('meta[name="author"]').attr('content')?.trim() || $('[rel="author"]').first().text().trim() || undefined;
    const publishedDate =
      $('meta[property="article:published_time"]').attr('content') ||
      $('meta[name="date"]').attr('content') ||
      $('time').first().attr('datetime') ||
      undefined;
    const authorQualifications = $('[class*="author-bio" i], [class*="byline" i], [itemprop="jobTitle"]').first().text().replace(/\s+/g, ' ').trim() || undefined;
    $('script, style, noscript, nav, header, footer, aside, .sidebar, .ad').remove();
    const parts: string[] = [];
    $('article p, main p, article h1, article h2, article h3, main h1, main h2, main h3, p, h1, h2, h3, li').each((_, element) => {
      const text = $(element).text().replace(/\s+/g, ' ').trim();
      if (text.length >= 25 && !parts.includes(text)) parts.push(text);
    });
    const text = parts.join('\n\n') || $('body').text().replace(/\s+/g, ' ').trim();
    if (text.length < 200) return null;
    return { url, title, text: text.slice(0, 16000), author, authorQualifications, publishedDate };
  } catch (error) {
    if (signal?.aborted) throw error;
    return null;
  }
}

async function searchWebSources(
  query: string,
  maxResults: number,
  page: number,
  excludeUrls: Set<string>,
  signal?: AbortSignal
): Promise<ScrapedWebResult[]> {
  let hits: Array<{ url: string; title: string }> = [];
  try {
    const search = await google.search(query, { page, safe: false });
    hits = (search.results || [])
      .filter((result) => result.url && !result.url.endsWith('.pdf') && !isBannedUrl(result.url))
      .map((result) => ({ url: result.url, title: result.title || result.url }));
  } catch (error) {
    console.warn('Blox Google search failed:', error);
  }

  if (hits.length < maxResults) {
    try {
      const response = await fetch(
        `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&s=${page * maxResults}`,
        {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
          signal: AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(8000)]),
        }
      );
      if (response.ok) {
        const $ = cheerio.load(await response.text());
        $('.result').each((_, element) => {
          const titleElement = $(element).find('.result__title a');
          const rawUrl = titleElement.attr('href') || '';
          let url = rawUrl;
          if (url.includes('uddg=')) url = new URLSearchParams(url.split('?')[1] || '').get('uddg') || url;
          if (url.startsWith('http') && !url.endsWith('.pdf') && !isBannedUrl(url)) {
            hits.push({ url, title: titleElement.text().trim() || url });
          }
        });
      }
    } catch (error) {
      if (signal?.aborted) throw error;
      console.warn('Blox DuckDuckGo search failed:', error);
    }
  }

  const seen = new Set<string>();
  const uniqueHits = hits.filter(({ url }) => {
    const normalized = normalizeSourceUrl(url);
    if (excludeUrls.has(normalized) || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  }).slice(0, maxResults);

  const sources = await Promise.all(uniqueHits.map(({ url, title }) => scrapeSource(url, title, signal)));
  return sources.filter((source): source is ScrapedWebResult => source !== null);
}

export async function POST(req: Request) {
  try {
    const body: BloxRequest = await req.json();
    const {
      argument = '',
      mode = 'web',
      customSources = [],
      count = 4,
      cycle = 0,
      excludeCards = [],
      excludeUrls = [],
      density = 'tech',
      providerMode = 'cloud',
      providerType = 'auto',
      apiKey,
      baseUrl,
      model,
      localBaseUrl,
      localModel,
      localApiKey,
    } = body;

    if (!argument.trim()) {
      return NextResponse.json({ error: 'Please enter an opponent argument or claim to refute.' }, { status: 400 });
    }

    const aiConfig: AiConfigOptions = {
      providerMode,
      providerType,
      apiKey,
      baseUrl,
      model,
      localBaseUrl,
      localModel,
      localApiKey,
      fallbackOnRateLimit: true,
      density,
      signal: req.signal,
    };

    const requestedCount = Math.max(1, Math.min(12, Math.floor(Number(count) || 4)));
    const excludedUrls = new Set(excludeUrls.map(normalizeSourceUrl));
    const sources: ScrapedWebResult[] = [];
    if (mode === 'custom') {
      for (const [index, rawSource] of customSources.entries()) {
        const value = rawSource.trim();
        if (!value) continue;
        if (/^https?:\/\//i.test(value)) {
          const source = await scrapeSource(value, `Custom Source ${index + 1}`, req.signal);
          if (source && !excludedUrls.has(normalizeSourceUrl(source.url))) sources.push(source);
        } else {
          sources.push({
            url: '',
            title: `Pasted Source ${index + 1}`,
            text: value.slice(0, 16000),
          });
        }
      }
    } else {
      const query = `evidence study empirical "${argument.slice(0, 120)}" counterarguments`;
      sources.push(...await searchWebSources(
        cycle > 0 ? `${query} research analysis ${cycle + 1}` : query,
        Math.min(24, Math.max(requestedCount * 3, 6)),
        cycle,
        excludedUrls,
        req.signal
      ));
    }

    if (sources.length === 0) {
      return NextResponse.json({
        error: mode === 'custom'
          ? 'No usable text or article pages were found in the custom sources.'
          : 'No usable source pages were found. Try a broader argument or another research mode.',
      }, { status: 422 });
    }

    const sourceContext = sources
      .map((source, index) => `SOURCE ${index + 1}\nTITLE: ${source.title}\nURL: ${source.url || 'User-provided text'}\nTEXT:\n${source.text.slice(0, 5000)}`)
      .join('\n\n====================\n\n');

    const densityInstruction = density === 'tech'
      ? 'DENSE, TECHNICAL, CIRCUIT DEBATE STYLE: Include explicit causal warrants, empirical thresholds, and nuanced mechanisms. Highlight read-aloud phrases punchily.'
      : 'LAY/PARENT JUDGE STYLE: Clear, vivid, persuasive arguments with straightforward logic and high-clarity warrants.';

    const systemPrompt = `You are a legendary debate strategist, National Champion coach, and tournament evidence card cutter.
The user is facing an OPPONENT ARGUMENT. Build a complete, tournament-ready ANSWER BLOCK (Blox) that refutes or turns this argument.
${densityInstruction}

You must return a complete strategic debate block with:
1. title: Punchy block title like "A2: [Opponent Argument]" or "Answers to: [Argument]"
2. claim: 1-2 sentence core frontline argument/claim
3. warrant: 2-3 sentences explaining the core structural and empirical reason why the opponent's argument is wrong
4. impact: Weighing calculus against the opponent's claim (magnitude, probability, timeframe, or reversibility)
5. frontlinePoints: 3 to 5 concise numbered talking points to read rapidly in a speech (2AC/2NC/1NR/2AR)
6. cards: An array of up to ${requestedCount} debate cards, each tied to exactly one supplied source. Include distinct strategic angles:
   - Card 1: Uniqueness / No Brink (Opponent's problem is not happening or already solved)
   - Card 2: Link Turn (The opposite of opponent's claim is true; action actually helps)
   - Card 3: Impact Turn or Defense (Opponent's impact is non-existent, exaggerated, or good)
   - Card 4: Alternative Fails / Solvency Takeout (Opponent's proposed alternative causes worse harm)

EACH CARD MUST INCLUDE:
- sourceIndex: 1-based index of the supplied source that directly supports the card.
- angle: The strategic purpose (uniqueness, link turn, impact defense/turn, solvency, or another evidence-supported answer).
- tag: A concise claim that is fully supported by the quoted evidence.
- highlightQuotes: 1-4 connected, complete sentences copied exactly from that source (usually a 100-400 word evidence passage). These must include a complete read-aloud warrant, not just a statistic or phrase.
- underlineQuotes: optional exact contiguous source sentences that provide necessary context.
- type: AFF, NEG, NQ, NL, DL, or T, based on what the evidence actually supports.

Do not invent or paraphrase evidence, citations, URLs, author names, dates, publications, or qualifications. Return fewer cards rather than unsupported cards. Do not return any field containing article body HTML; the server validates exact quotations and builds the formatted card from the source itself.

Output strictly valid JSON:
{
  "title": "A2: ...",
  "claim": "...",
  "warrant": "...",
  "impact": "...",
  "frontlinePoints": ["1. ...", "2. ...", "3. ..."],
  "cards": [
    {
      "sourceIndex": 1,
      "angle": "Link turn",
      "tag": "The evidence-backed debate claim",
      "highlightQuotes": ["Exact source sentence one. Exact source sentence two."],
      "underlineQuotes": ["Exact adjacent context."],
      "type": "NEG"
    }
  ]
}`;

    const userPrompt = `OPPONENT ARGUMENT TO REFUTE:
"${argument}"

${excludeCards.length ? `ALREADY USED CARDS (create fresh cards with different sources and evidence; do not repeat these):\n${excludeCards.map((card, index) => `${index + 1}. ${card}`).join('\n')}\n\n` : ''}
ACTUAL SOURCE MATERIAL (use only these sources for evidence cards):
${sourceContext}`;

    const { completion, usedLocal, modelUsed } = await runChatCompletionWithFallback(aiConfig, {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.3,
      max_tokens: 3800,
    });

    const parsedValue: unknown = JSON.parse(completion.choices[0]?.message?.content || '{}');
    const parsed = isRecord(parsedValue) ? parsedValue : {};
    const seenCards = new Set<string>();
    const seenSources = new Set<string>();
    const formattedCards = (Array.isArray(parsed.cards) ? parsed.cards.filter(isRecord) : [])
      .slice(0, requestedCount)
      .flatMap((candidate, index) => {
        const sourceIndex = Number(candidate.sourceIndex) - 1;
        const preferredSource = Number.isInteger(sourceIndex) ? sources[sourceIndex] : undefined;
        if (!preferredSource) return [];
        const bodyHtml = formatSourceGroundedCard(
          preferredSource.text,
          candidate.highlightQuotes,
          candidate.underlineQuotes,
          false
        );
        if (!bodyHtml) return [];
        const sourceFingerprint = normalizeSourceUrl(preferredSource.url) || preferredSource.title.toLowerCase();
        const fingerprint = `${sourceFingerprint}|${bodyHtml.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().toLowerCase()}`;
        if (seenCards.has(fingerprint) || seenSources.has(sourceFingerprint)) return [];
        seenCards.add(fingerprint);
        seenSources.add(sourceFingerprint);
        const citation = formatSourceCitation(preferredSource);
        const generatedType = typeof candidate.type === 'string' ? candidate.type.toUpperCase() : '';
        const cardType = ['AFF', 'NEG', 'NQ', 'NL', 'DL', 'T'].includes(generatedType)
          ? generatedType
          : 'NEG';
        return [{
          id: `blox_${Date.now()}_${cycle}_${index}`,
          tag: stringOr(candidate.tag, `[${cardType}] Evidence-based answer to ${argument.slice(0, 70)}`),
          citation,
          bodyHtml,
          type: cardType,
          kind: 'blox',
          blockTitle: stringOr(parsed.title, `A2: ${argument}`),
          combatClaim: argument,
          sourceTitle: preferredSource.title,
          sourceUrl: preferredSource.url || undefined,
          author: preferredSource.author,
          authorQualifications: preferredSource.authorQualifications,
          publishedDate: preferredSource.publishedDate,
          reasoning: stringOr(candidate.angle, 'Evidence-backed answer to the opponent argument.'),
        }];
      });

    if (formattedCards.length === 0) {
      return NextResponse.json({
        error: 'The model did not return any cards with verifiable, source-exact evidence. Try again or use different sources.',
        webSourcesFound: sources.length,
      }, { status: 422 });
    }

    const review = await reviewSourceGroundedCards(
      aiConfig,
      formattedCards.map((card) => ({
        id: card.id,
        target: `Refute, turn, or materially weaken the opponent argument: ${argument}`,
        strategy: card.reasoning,
        tag: card.tag,
        bodyHtml: card.bodyHtml,
        sourceTitle: card.sourceTitle,
      }))
    );
    const reviewedCards = formattedCards
      .filter((card) => review.acceptedIds.has(card.id))
      .map((card) => ({
        ...card,
        reasoning: [card.reasoning, review.reasons.get(card.id)].filter(Boolean).join(' '),
      }));

    if (reviewedCards.length === 0) {
      return NextResponse.json({
        error: 'The cards contained verifiable quotations, but none passed the relevance and tag-accuracy review for this opponent argument.',
        webSourcesFound: sources.length,
      }, { status: 422 });
    }

    const block = {
      id: `block_${Date.now()}`,
      title: stringOr(parsed.title, `A2: ${argument}`),
      side: 'Negative',
      claim: stringOr(parsed.claim, `Answers to ${argument}`),
      warrant: stringOr(parsed.warrant, 'The opponent claim fails empirically and structurally.'),
      impact: stringOr(parsed.impact, 'Outweighs on probability and magnitude.'),
      frontlinePoints: Array.isArray(parsed.frontlinePoints)
        ? parsed.frontlinePoints.filter((point): point is string => typeof point === 'string')
        : [],
      cards: reviewedCards,
      createdAt: new Date().toISOString(),
    };

    return NextResponse.json({
      block,
      usedLocal,
      modelUsed,
      webSourcesFound: sources.length,
    });
  } catch (error: unknown) {
    console.error('Blox route error:', error);
    const msg = error instanceof Error ? error.message : 'Failed to build blox';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
