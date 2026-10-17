import { NextResponse } from 'next/server';
import * as cheerio from 'cheerio';
import { runChatCompletionWithFallback, AiConfigOptions } from '../../../lib/aiProvider';
import { isBannedUrl, getBannedUrlMessage } from '../../../lib/domainFilters';
import { formatSourceCitation, formatSourceGroundedCard } from '../../../lib/sourceGroundedCards';

interface BatchSourceItem {
  id: string;
  url?: string;
  text?: string;
  title?: string;
}

interface BatchCutRequest {
  sources: BatchSourceItem[];
  excludePassagesBySource?: Record<string, string[]>;
  goal?: string;
  density?: 'tech' | 'lay';
  cardType?: string;
  providerMode?: 'cloud' | 'local' | 'auto';
  providerType?: 'auto' | 'grok' | 'openai' | 'groq' | 'openrouter' | 'deepseek' | 'custom' | 'local';
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  localBaseUrl?: string;
  localModel?: string;
  localApiKey?: string;
}

async function scrapeUrl(url: string): Promise<{ text: string; title: string; author?: string; publishedDate?: string }> {
  if (isBannedUrl(url)) {
    throw new Error(getBannedUrlMessage(url));
  }
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`Failed to fetch URL (${res.status} ${res.statusText})`);

  const html = await res.text();
  const $ = cheerio.load(html);
  const title = $('meta[property="og:title"]').attr('content') || $('title').text() || url;
  const author = $('meta[name="author"]').attr('content') || $('[rel="author"]').first().text() || undefined;
  const publishedDate = $('meta[property="article:published_time"]').attr('content') || $('time').first().attr('datetime') || undefined;

  $('script, style, noscript, nav, header, footer, aside, .sidebar, .ad').remove();
  let fullText = '';
  $('p, h1, h2, h3, h4, h5, h6, li').each((_, el) => {
    const t = $(el).text().replace(/\s+/g, ' ').trim();
    if (t) fullText += t + '\n\n';
  });
  if (!fullText.trim()) fullText = $('body').text().replace(/\s+/g, ' ').trim();

  return { text: fullText.trim(), title: title.trim(), author, publishedDate };
}

export async function POST(req: Request) {
  try {
    const body: BatchCutRequest = await req.json();
    const {
      sources = [],
      goal = '',
      density = 'tech',
      cardType = 'AFF',
      providerMode = 'cloud',
      providerType = 'auto',
      apiKey,
      baseUrl,
      model,
      localBaseUrl,
      localModel,
      localApiKey,
    } = body;

    if (!sources || !sources.length) {
      return NextResponse.json({ error: 'No sources provided for batch cutting' }, { status: 400 });
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
      signal: req.signal,
      fallbackOnRateLimit: true,
      density,
    };

    const results: Array<{
      sourceId: string;
      sourceTitle: string;
      sourceUrl?: string;
      cards: Array<{
        id: string;
        tag: string;
        citation: string;
        bodyHtml: string;
        type: string;
        reasoning?: string;
        sourceTitle?: string;
        sourceUrl?: string;
        author?: string;
      }>;
    }> = [];
    const errors: Array<{ sourceId: string; error: string }> = [];

    // Process sources concurrently with pool
    const processSource = async (sourceItem: BatchSourceItem) => {
      try {
        let content = (sourceItem.text || '').trim();
        let title = sourceItem.title || 'Source';
        let author = '';
        let publishedDate = '';
        const url = sourceItem.url?.trim() || '';

        if (url && !content) {
          const scraped = await scrapeUrl(url);
          content = scraped.text;
          title = scraped.title || title;
          author = scraped.author || '';
          publishedDate = scraped.publishedDate || '';
        }

        if (!content || content.length < 60) {
          errors.push({ sourceId: sourceItem.id, error: 'Source text was too short or empty' });
          return;
        }

        const citation = formatSourceCitation({
          author,
          publishedDate,
          title,
          url,
        });

        const densityGuidance = density === 'tech'
          ? 'Cut DENSELY and technically for policy/circuit debate. Maintain rigorous causal links, empirical warrants, and detailed statistics.'
          : 'Cut LIGHTLY and clearly for lay/parent debate. Highlight accessible, persuasive warrants that are easy to understand when spoken.';

        const excludedPassages = body.excludePassagesBySource?.[sourceItem.id] ?? [];
        const systemPrompt = `You are an elite competitive debate card cutter.
${densityGuidance}
Given an article, extract the single best debate card (or cards) that support the target argument.
${excludedPassages.length ? 'Do not reuse or paraphrase passages listed as already cut.' : ''}

RULES:
1. Tag: A punchy, bold argumentative warrant (under 15 words) proving the claim. Prefix with "[${cardType}]".
2. highlightQuotes: 1-3 continuous verbatim sentences from the article that prove the tag and will be read aloud.
3. underlineQuotes: 1-2 adjacent sentences providing essential context or warrants.
4. warrant: 1 sentence summarizing why this evidence proves the argument.

Return ONLY JSON:
{
  "cards": [
    {
      "tag": "[${cardType}] Tag claim here",
      "highlightQuotes": ["Exact read aloud passage from text"],
      "underlineQuotes": ["Exact supporting passage from text"],
      "warrant": "Analytical explanation"
    }
  ]
}`;

        const userPrompt = `GOAL / FOCUS: ${goal || 'Cut the strongest debate card from this article.'}
ARTICLE TITLE: ${title}
SOURCE URL: ${url || 'N/A'}

SOURCE MATERIAL:
${content.slice(0, 16000)}
${excludedPassages.length ? `\n\nPASSAGES ALREADY CUT:\n${excludedPassages.map((passage, index) => `${index + 1}. ${passage}`).join('\n')}` : ''}`;

        const { completion } = await runChatCompletionWithFallback(aiConfig, {
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          response_format: { type: 'json_object' },
          temperature: 0.2,
          max_tokens: 2500,
        });

        const parsed = JSON.parse(completion.choices[0]?.message?.content || '{}');
        const rawCards = Array.isArray(parsed.cards) ? parsed.cards : parsed.tag ? [parsed] : [];

        const sourceCards = rawCards.flatMap((c: { tag?: string; highlightQuotes?: string[]; underlineQuotes?: string[]; warrant?: string }, idx: number) => {
          const bodyHtml = formatSourceGroundedCard(content, c.highlightQuotes || [], c.underlineQuotes || []);
          if (!bodyHtml) return [];
          return [{
            id: `batch_${sourceItem.id}_${idx}_${Date.now()}`,
            tag: c.tag || `[${cardType}] ${title}`,
            citation,
            bodyHtml,
            type: cardType,
            reasoning: c.warrant,
            sourceTitle: title,
            sourceUrl: url || undefined,
            author,
          }];
        });

        if (sourceCards.length > 0) {
          results.push({
            sourceId: sourceItem.id,
            sourceTitle: title,
            sourceUrl: url || undefined,
            cards: sourceCards,
          });
        } else {
          errors.push({ sourceId: sourceItem.id, error: 'No usable cards extracted' });
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Failed to process source';
        errors.push({ sourceId: sourceItem.id, error: msg });
      }
    };

    await Promise.all(sources.map((s) => processSource(s)));

    return NextResponse.json({
      results,
      errors,
      totalCards: results.reduce((acc, r) => acc + r.cards.length, 0),
    });
  } catch (error: unknown) {
    console.error('Batch cut route error:', error);
    const msg = error instanceof Error ? error.message : 'Batch cut failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
