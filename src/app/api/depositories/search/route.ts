import { NextResponse } from 'next/server';
import google from 'googlethis';
import * as cheerio from 'cheerio';
import { createAiClient, AiProviderMode, AiProviderType } from '../../../../lib/aiProvider';
import {
  buildEvidenceFallback,
  isEvidenceFromSource,
  normalizeEvidenceText,
  sanitizeEvidenceHtml,
} from '../../../../lib/evidence';

interface DepositoriesSearchRequest {
  query?: string;
  depositSource?: 'all' | 'debatify' | 'logos' | 'opencaselist' | 'prepsync';
  side?: 'all' | 'aff' | 'neg';
  limit?: number;
  providerMode?: AiProviderMode;
  providerType?: AiProviderType;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  localBaseUrl?: string;
  localModel?: string;
  localApiKey?: string;
}

const DEPOSITORY_DOMAINS = [
  'opencaselist.com',
  'hspolicy.debatecoaches.org',
  'cedadebate.org',
  'debatify.io',
  'debatify.app',
  'logos.college',
  'logosdebate.com',
  'prepsync.com',
];

function isKnownDepositoryUrl(value: string): boolean {
  try {
    const { hostname, protocol } = new URL(value);
    return ['http:', 'https:'].includes(protocol) && DEPOSITORY_DOMAINS.some(
      (domain) => hostname === domain || hostname.endsWith(`.${domain}`)
    );
  } catch {
    return false;
  }
}

function getSourceName(url: string): string {
  if (url.includes('debatify')) return 'Debatify';
  if (url.includes('logos')) return 'Logos';
  if (url.includes('prepsync')) return 'Online Debate Archive';
  if (url.includes('cedadebate')) return 'CEDA Debate';
  return 'Open Case List';
}

export async function POST(req: Request) {
  try {
    const {
      query,
      depositSource = 'all',
      side = 'all',
      limit = 10,
      providerMode,
      providerType,
      apiKey,
      baseUrl,
      model: requestedModel,
      localBaseUrl,
      localModel,
      localApiKey,
    }: DepositoriesSearchRequest = await req.json();

    if (!query || !query.trim()) {
      return NextResponse.json({ error: 'Query parameter is required' }, { status: 400 });
    }

    const trimmedQuery = query.trim().slice(0, 350);
    const safeLimit = Math.max(1, Math.min(Number.isFinite(limit) ? Math.floor(limit) : 10, 15));
    let siteFilter = '';

    if (depositSource === 'opencaselist') {
      siteFilter = 'site:opencaselist.com OR site:hspolicy.debatecoaches.org';
    } else if (depositSource === 'debatify') {
      siteFilter = 'site:debatify.io OR site:debatify.app';
    } else if (depositSource === 'logos') {
      siteFilter = 'site:logos.college OR site:logosdebate.com';
    } else if (depositSource === 'prepsync') {
      siteFilter = 'site:prepsync.com';
    } else {
      siteFilter = '(site:opencaselist.com OR site:debatify.io OR site:logos.college OR site:prepsync.com OR site:hspolicy.debatecoaches.org OR site:cedadebate.org)';
    }

    const sideModifier = side === 'aff' ? 'Affirmative' : side === 'neg' ? 'Negative' : '';
    const fullSearchQuery = `${trimmedQuery} ${sideModifier} ${siteFilter} debate cards`.trim();

    console.log(`Searching depositories: "${fullSearchQuery}"`);

    let searchResults: Array<{ url: string; title: string; snippet: string }> = [];

    try {
      const gRes = await google.search(fullSearchQuery, { page: 0, safe: false });
      if (gRes.results && gRes.results.length > 0) {
        searchResults = gRes.results.map((r: { url: string; title: string; description?: string }) => ({
          url: r.url,
          title: r.title,
          snippet: r.description || '',
        }));
      }
    } catch (e) {
      console.warn('Google search failed for depositories, using fallback search query', e);
    }

    // Retry the same trusted sources with a broader phrasing if needed
    if (searchResults.length < 3) {
      try {
        const gResFallback = await google.search(`${trimmedQuery} ${sideModifier} ${siteFilter} evidence block`, { page: 0, safe: false });
        if (gResFallback.results && gResFallback.results.length > 0) {
          const fallbackResults = gResFallback.results.map((r: { url: string; title: string; description?: string }) => ({
            url: r.url,
            title: r.title,
            snippet: r.description || '',
          }));
          searchResults = [...searchResults, ...fallbackResults];
        }
      } catch (e) {
        console.error('Fallback search failed', e);
      }
    }

    const uniqueSearchResults = Array.from(
      new Map(
        searchResults
          .filter((item) => isKnownDepositoryUrl(item.url))
          .map((item) => [item.url, item])
      ).values()
    );

    const scrapedCards: Array<{
      id: string;
      title: string;
      tag: string;
      citation: string;
      bodyHtml: string;
      type: string;
      sourceDeposit: string;
      url: string;
    }> = [];

    const { client: ai, model } = createAiClient({
      providerMode,
      providerType,
      apiKey,
      baseUrl,
      model: requestedModel,
      localBaseUrl,
      localModel,
      localApiKey,
    });

    for (let i = 0; i < Math.min(uniqueSearchResults.length, safeLimit); i++) {
      const item = uniqueSearchResults[i];
      const sourceDepositName = getSourceName(item.url);

      let pageText = item.snippet;

      try {
        const fetchRes = await fetch(item.url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
          signal: AbortSignal.timeout(5000),
        });
        if (fetchRes.ok) {
          const html = await fetchRes.text();
          const $ = cheerio.load(html);
          $('script, style, noscript, nav, header, footer, aside').remove();
          const bodyText = normalizeEvidenceText($('body').text());
          if (bodyText.length > 200) {
            pageText = bodyText.slice(0, 5000);
          }
        }
      } catch {
        // use snippet if fetch fails
      }

      if (!pageText || pageText.length < 50) continue;

      try {
        const cardCutRes = await ai.chat.completions.create({
          model,
          messages: [
            {
              role: 'system',
              content: `You are a debate card indexer. Given text from a debate card depository (${sourceDepositName}), extract or format a single debate card.
Format requirements:
- tag: Concise debate tag line.
- citation: Complete author, year, title, URL citation.
- bodyHtml: Verbatim quote. Highlight core warrants with <mark>...</mark> and underline surrounding context with <u>...</u>.
- type: 'AFF' or 'NEG'.
Respond ONLY with JSON: {"tag": "...", "citation": "...", "bodyHtml": "...", "type": "AFF|NEG"}`
            },
            {
              role: 'user',
              content: `Source URL: ${item.url}\nTitle: ${item.title}\nText:\n${pageText}`
            }
          ],
          response_format: { type: 'json_object' },
          temperature: 0.1,
        });

        const parsed = JSON.parse(cardCutRes.choices[0]?.message?.content || '{}') as Record<string, unknown>;
        const cleanedBody = sanitizeEvidenceHtml(parsed.bodyHtml);
        const bodyHtml = isEvidenceFromSource(cleanedBody, pageText)
          ? cleanedBody
          : buildEvidenceFallback(pageText, `${trimmedQuery} ${sideModifier}`);

        if (bodyHtml.length > 30) {
          scrapedCards.push({
            id: `dep_${Date.now()}_${i}`,
            title: item.title,
            tag: typeof parsed.tag === 'string' && parsed.tag.trim() ? parsed.tag.trim().slice(0, 220) : item.title,
            citation: typeof parsed.citation === 'string' && parsed.citation.trim() ? parsed.citation.trim().slice(0, 500) : `${item.title} - ${item.url}`,
            bodyHtml,
            type: parsed.type === 'NEG' || parsed.type === 'AFF' ? parsed.type : (side === 'neg' ? 'NEG' : 'AFF'),
            sourceDeposit: sourceDepositName,
            url: item.url,
          });
        }
      } catch (err) {
        console.error('Card indexing failed for item', err);
      }
    }

    return NextResponse.json({
      cards: scrapedCards,
      query: trimmedQuery,
      source: depositSource,
      count: scrapedCards.length,
      searchedSources: uniqueSearchResults.length,
      modelUsed: model,
    });
  } catch (error: unknown) {
    console.error('Depositories search route error:', error);
    const message = error instanceof Error ? error.message : 'Unknown search error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
