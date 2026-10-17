import { NextResponse } from 'next/server';
import * as cheerio from 'cheerio';
import google from 'googlethis';
import { runChatCompletionWithFallback, AiConfigOptions } from '../../../lib/aiProvider';
import { isBannedUrl } from '../../../lib/domainFilters';
import { emphasizeReadAloudKeywords } from '../../../lib/evidence';
import {
  buildSourceGroundedFallbackQuotes,
  formatSourceCitation,
  formatSourceGroundedCard,
  reviewSourceGroundedCards,
} from '../../../lib/sourceGroundedCards';

export type TopicMode = 'contention' | 'rebuttal' | 'both';
export type SidePreference = 'both' | 'aff' | 'neg';

interface TopicCardsRequest {
  topic: string;
  targetUrls?: string[] | string;
  mode?: TopicMode;
  sidePreference?: SidePreference;
  cardCount?: number;
  cycle?: number;
  excludeUrls?: string[];
  customSources?: string[];
  customText?: string;
  providerMode?: 'cloud' | 'local' | 'auto';
  providerType?: 'auto' | 'grok' | 'openai' | 'groq' | 'openrouter' | 'deepseek' | 'custom' | 'local';
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  density?: 'tech' | 'lay';
  localBaseUrl?: string;
  localModel?: string;
  localApiKey?: string;
  groqApiKeys?: string[];
  apiKeyIndex?: number;
}

interface AngleDefinition {
  mode: 'contention' | 'rebuttal';
  side: 'AFF' | 'NEG';
  claim: string;
  role: string;
  searchQueries: string[];
}

interface RawCutCard {
  tag?: string;
  highlightQuotes?: string[];
  underlineQuotes?: string[];
  type?: string;
  cardMode?: 'contention' | 'rebuttal';
  warrant?: string;
  strategyAdvice?: string;
}

interface ScrapedArticle {
  url: string;
  title: string;
  text: string;
  author?: string;
  authorQualifications?: string;
  publishedDate?: string;
}

function parseTargetUrls(rawValue: string | string[] | undefined): string[] {
  if (!rawValue) return [];
  const list = Array.isArray(rawValue) ? rawValue : rawValue.split(/[\n,]+/);
  const validUrls: string[] = [];
  for (const entry of list) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    try {
      const parsed = new URL(candidate);
      if (['http:', 'https:'].includes(parsed.protocol) && parsed.hostname.includes('.')) {
        validUrls.push(parsed.href);
      }
    } catch {
      // Ignore invalid URLs
    }
  }
  return Array.from(new Set(validUrls));
}

function cleanText(value: string): string {
  return value
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line, index, lines) => line.length >= 25 && lines.indexOf(line) === index)
    .join('\n\n')
    .trim();
}

function isRateLimitError(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'status' in error && error.status === 429;
}

function cleanMetadataValue(value?: string | null): string | undefined {
  const cleaned = value?.replace(/\s+/g, ' ').trim();
  return cleaned || undefined;
}

function extractDate($: cheerio.CheerioAPI): string | undefined {
  const metaDate =
    $('meta[property="article:published_time"]').attr('content') ||
    $('meta[name="date"]').attr('content') ||
    $('meta[name="pubdate"]').attr('content') ||
    $('meta[name="publish_date"]').attr('content') ||
    $('time').first().attr('datetime') ||
    $('time').first().text();
  
  if (metaDate) {
    const cleaned = cleanMetadataValue(metaDate);
    if (cleaned) return cleaned.slice(0, 10);
  }
  return undefined;
}

function extractAuthorDetails($: cheerio.CheerioAPI): { author?: string; qualifications?: string; publishedDate?: string } {
  const author =
    cleanMetadataValue($('meta[name="author"]').attr('content')) ||
    cleanMetadataValue($('meta[property="article:author"]').attr('content')) ||
    cleanMetadataValue($('meta[name="parsely-author"]').attr('content')) ||
    cleanMetadataValue($('[rel="author"]').first().text());

  const visibleBio = cleanMetadataValue(
    $('[class*="author-bio" i], [class*="author__bio" i], [class*="byline" i], [itemprop="jobTitle"]').first().text()
  );

  const publishedDate = extractDate($);

  return { author, qualifications: visibleBio, publishedDate };
}

async function scrapeUrl(url: string): Promise<ScrapedArticle | null> {
  if (isBannedUrl(url)) return null;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return null;

    const html = await res.text();
    const $ = cheerio.load(html);
    const title =
      cleanMetadataValue($('meta[property="og:title"]').attr('content')) ||
      cleanMetadataValue($('title').text()) ||
      url;
    const { author, qualifications: authorQualifications, publishedDate } = extractAuthorDetails($);

    $('script, style, noscript, nav, header, footer, aside, .sidebar, .ad').remove();

    const parts: string[] = [];
    $('p, h1, h2, h3, h4, li').each((_, el) => {
      const text = $(el).text().replace(/\s+/g, ' ').trim();
      if (text.length >= 25 && !parts.includes(text)) parts.push(text);
    });

    const text = cleanText(parts.join('\n\n') || $('body').text());
    if (text.length < 100) return null;

    return { url, title, text, author, authorQualifications, publishedDate };
  } catch {
    return null;
  }
}

async function searchWebForQuery(query: string, maxResults = 3, page = 0): Promise<Array<{ url: string; title: string }>> {
  const results: Array<{ url: string; title: string }> = [];

  try {
    const gRes = await google.search(query, { page, safe: false });
    if (gRes.results && gRes.results.length > 0) {
      for (const r of gRes.results) {
        if (r.url && !isBannedUrl(r.url) && !r.url.endsWith('.pdf')) {
          results.push({ url: r.url, title: r.title || r.url });
          if (results.length >= maxResults) break;
        }
      }
    }
  } catch (err) {
    console.warn('Google search query failed in topic-cards:', query, err);
  }

  // Supplement partial Google results with a second search provider.
  if (results.length < maxResults) {
    try {
      const ddgUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&s=${page * maxResults}`;
      const ddgRes = await fetch(ddgUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        },
        signal: AbortSignal.timeout(8000),
      });
      if (ddgRes.ok) {
        const ddgHtml = await ddgRes.text();
        const $ddg = cheerio.load(ddgHtml);
        $ddg('.result__url, .result__title a, a[class*="result__url"]').each((_, el) => {
          let link = $ddg(el).attr('href') || $ddg(el).closest('.result').find('.result__title a').attr('href') || '';
          if (link.includes('uddg=')) {
            const params = new URLSearchParams(link.split('?')[1] ?? '');
            link = params.get('uddg') || link;
          }
          const parent = $ddg(el).closest('.result');
          const title = parent.find('.result__title').text().trim() || link;
          if (link.startsWith('http') && !isBannedUrl(link) && !link.endsWith('.pdf')) {
            if (!results.some((result) => result.url.toLowerCase() === link.toLowerCase())) {
              results.push({ url: link, title });
            }
          }
        });
      }
    } catch {
      // Ignore fallback errors
    }
  }

  return results.slice(0, maxResults);
}

export async function POST(req: Request) {
  try {
    const body: TopicCardsRequest = await req.json();
    const {
      topic,
      targetUrls: rawTargetUrls,
      mode = 'both',
      sidePreference = 'both',
      cardCount = 6,
      cycle = 0,
      excludeUrls = [],
      customSources = [],
      customText = '',
      providerMode = 'auto',
      providerType = 'auto',
      apiKey,
      baseUrl,
      model,
      density = 'tech',
      localBaseUrl,
      localModel,
      localApiKey,
      groqApiKeys = [],
      apiKeyIndex = 0,
    } = body;

    if (!topic || !topic.trim()) {
      return NextResponse.json({ error: 'Please provide a debate topic.' }, { status: 400 });
    }

    const trimmedTopic = topic.trim();
    const resolvedApiKey = apiKey || groqApiKeys[apiKeyIndex] || groqApiKeys[0];
    const aiConfig: AiConfigOptions = {
      providerMode,
      providerType,
      apiKey: resolvedApiKey,
      baseUrl,
      model,
      density,
      localBaseUrl,
      localModel,
      localApiKey,
      signal: req.signal,
      fallbackOnRateLimit: false,
    };

    const combinedUrls = [
      ...parseTargetUrls(rawTargetUrls),
      ...parseTargetUrls(customSources),
    ];
    const excludedUrlSet = new Set(excludeUrls.map((url) => url.toLowerCase().replace(/\/+$/, '')));
    const targetedUrls = Array.from(new Set(combinedUrls)).filter(
      (url) => !excludedUrlSet.has(url.toLowerCase().replace(/\/+$/, ''))
    );
    if (combinedUrls.length > 0 && targetedUrls.length === 0) {
      return NextResponse.json({
        topic: trimmedTopic,
        mode,
        cards: [],
        sourceUrls: [],
        notice: 'All targeted websites have already been checked. Add another URL to find more cards.',
      });
    }

    const cards: Array<{
      id: string;
      contention: string;
      tag: string;
      citation: string;
      bodyHtml: string;
      type: string;
      cardMode: 'contention' | 'rebuttal';
      reasoning: string;
      sourceTitle: string;
      sourceUrl?: string;
      author?: string;
      authorQualifications?: string;
      strategyTarget?: string;
    }> = [];

    const reviewTopicCards = async (candidates: typeof cards) => {
      const review = await reviewSourceGroundedCards(
        aiConfig,
        candidates.map((card) => ({
          id: card.id,
          target: `Debate topic: ${trimmedTopic}\nRequested mode: ${mode}\nSide focus: ${sidePreference}\nCard target: ${card.contention}\nCard mode: ${card.cardMode}`,
          strategy: card.strategyTarget || card.reasoning,
          tag: card.tag,
          bodyHtml: card.bodyHtml,
          sourceTitle: card.sourceTitle,
        }))
      );
      return candidates
        .filter((card) => review.acceptedIds.has(card.id))
        .map((card) => ({
          ...card,
          reasoning: [card.reasoning, review.reasons.get(card.id)].filter(Boolean).join(' '),
        }));
    };

    const seenBodies = new Set<string>();
    let usedLocalModel = false;

    // ──────────────────────────────────────────────────────────────────────────
    // PATH A: TARGETED WEBSITES FUNCTION (DEEP CUT ENTIRE ARTICLE)
    // ──────────────────────────────────────────────────────────────────────────
    if (targetedUrls.length > 0) {
      for (let uIdx = 0; uIdx < targetedUrls.length && cards.length < cardCount; uIdx++) {
        const targetUrl = targetedUrls[uIdx];
        const scraped = await scrapeUrl(targetUrl);
        if (!scraped || scraped.text.length < 100) continue;

        const citation = formatSourceCitation(scraped);

        // Prompt for tech debate card cutting:
        // Cut the whole article in one card; neon blue highlights explain the contention in pseudo-English;
        // underlines for context; all other text small.
        const targetedPrompt = `You are a premier Tech Debate Card Cutter.
Examine this article and cut a high-impact debate card on the topic: "${trimmedTopic}".

Selected Mode: "${mode.toUpperCase()}"
- "CONTENTION": Proactive constructive case evidence (1AC/1NC advantages, disadvantages, solvency mechanisms, quantified impacts).
- "REBUTTAL": Evidence that directly answers an opponent's specific contention: non-uniqueness, no link, no solvency, impact defense, or a turn. Do not write a standalone affirmative advantage, negative disadvantage, or other constructive contention.
- "BOTH": Provide cards that can serve either as case contentions or sharp rebuttal responses.
Side Preference: "${sidePreference}"

TECH DEBATE CUTTING RULES:
1. Select one to three complete, contiguous sentences copied exactly from the article for highlightQuotes. Do not paraphrase or combine text.
2. The highlighted text must directly support the target argument, preserve its qualifiers, and contain a complete read-aloud warrant.
3. Select only exact adjacent source text for underlineQuotes when needed to explain context.
4. In rebuttal mode, evidence must answer an opponent argument; do not present a standalone contention.
5. Use concise pseudo-English in the tag, but never claim more than the selected evidence proves.
6. Set type to AFF or NEG consistent with the requested side and cardMode to contention or rebuttal.
7. Do not create citations; the server derives citation details from the article.

ARTICLE FULL TEXT:
${scraped.text.slice(0, 12000)}

Respond ONLY with valid JSON:
{
  "tag": "[SIDE - MODE] Punchy debate tagline summarizing what highlights prove",
  "highlightQuotes": ["exact contiguous source passage"],
  "underlineQuotes": ["exact supporting context, if needed"],
  "type": "AFF" or "NEG",
  "cardMode": "contention" or "rebuttal",
  "warrant": "1-sentence summary of the core warrant",
  "strategyAdvice": "Advice on how to run this card in round"
}`;

        try {
          const { completion, usedLocal } = await runChatCompletionWithFallback(aiConfig, {
            messages: [{ role: 'user', content: targetedPrompt }],
            response_format: { type: 'json_object' },
            temperature: 0.15,
            max_tokens: 3800,
          });

          if (usedLocal) usedLocalModel = true;

          const parsed = JSON.parse(completion.choices[0]?.message?.content || '{}') as RawCutCard;

          const bodyHtml = formatSourceGroundedCard(
            scraped.text,
            parsed.highlightQuotes ?? [],
            parsed.underlineQuotes ?? []
          ) || formatSourceGroundedCard(
            scraped.text,
            buildSourceGroundedFallbackQuotes(scraped.text, `${trimmedTopic} ${mode} ${sidePreference}`, 2)
          );
          if (bodyHtml) {
            const cleanBody = emphasizeReadAloudKeywords(bodyHtml);
            const cardSide = sidePreference === 'neg' ? 'NEG' : sidePreference === 'aff' ? 'AFF' : parsed.type === 'NEG' ? 'NEG' : 'AFF';
            const cardMode: 'contention' | 'rebuttal' =
              mode === 'contention'
                ? 'contention'
                : mode === 'rebuttal'
                ? 'rebuttal'
                : parsed.cardMode === 'rebuttal' || (parsed.tag && parsed.tag.toUpperCase().includes('REBUTTAL'))
                ? 'rebuttal'
                : 'contention';

            cards.push({
              id: `topic_target_${Date.now()}_${uIdx}`,
              contention: parsed.warrant || `Evidence from ${scraped.title}`,
              tag: parsed.tag || `[${cardSide} - ${cardMode.toUpperCase()}] ${scraped.title}`,
              citation,
              bodyHtml: cleanBody,
              type: cardSide,
              cardMode,
              reasoning: parsed.strategyAdvice || parsed.warrant || (cardMode === 'rebuttal' ? 'Rebuttal Card: Use in rebuttal speeches to answer opponent contentions.' : 'Contention Card: Use in constructive speeches as part of your case.'),
              sourceTitle: scraped.title,
              sourceUrl: scraped.url,
              author: scraped.author,
              authorQualifications: scraped.authorQualifications,
              strategyTarget: `Deep Cut: ${scraped.title}`,
            });
          }
        } catch (err) {
          if (isRateLimitError(err)) throw err;
          console.warn('Targeted site cut error:', err);
        }
      }

      if (cards.length > 0) {
        const reviewedCards = await reviewTopicCards(cards);
        if (reviewedCards.length === 0) {
          cards.length = 0;
        } else {
        return NextResponse.json({
          topic: trimmedTopic,
          mode,
          targetedWebsites: targetedUrls,
          sourceUrls: targetedUrls,
          cards: reviewedCards,
          count: reviewedCards.length,
          usedLocalModel,
          notice: `${usedLocalModel ? 'Cards cut using Local Open-Weight Model. ' : ''}Cards were independently reviewed for relevance and accurate tags.`,
        });
        }
      }
    }

    // ──────────────────────────────────────────────────────────────────────────
    // PATH B: AUTONOMOUS TOPIC-WIDE DISCOVERY & SEARCH
    // ──────────────────────────────────────────────────────────────────────────

    const numAngles = Math.max(3, Math.min(cardCount, 8));
    const anglePrompt = `You are a world-class debate coach and research strategist.
Debate Topic: "${trimmedTopic}"
Selected Mode: "${mode}" ("contention" = constructive cases, "rebuttal" = turns/answers to contentions, "both" = mix)
Side Preference: "${sidePreference}"

Formulate ${numAngles} DISTINCT, HIGH-YIELD debate angles on this topic.
- In "contention" mode: affirmative advantages, negative disadvantages, solvency mechanisms, quantified impacts for constructive cases.
- In "rebuttal" mode: identify the most common arguments on this topic and formulate sharp refutations (link turns, solvency takeouts, impact defense).
- In "both" mode: even split between constructive contention cards and rebuttal answer cards.

Respond ONLY with JSON:
{
  "angles": [
    {
      "mode": "contention" or "rebuttal",
      "side": "AFF" or "NEG",
      "claim": "Concise statement of what the card proves",
      "role": "e.g. 1AC Advantage / 1NC Core Disad / Turn to Economy / Solvency Takeout",
      "searchQueries": ["search query 1", "search query 2"]
    }
  ]
}`;

    let angles: AngleDefinition[] = [];
    try {
      const { completion, usedLocal } = await runChatCompletionWithFallback(aiConfig, {
        messages: [{ role: 'user', content: anglePrompt }],
        response_format: { type: 'json_object' },
        temperature: 0.2,
        max_tokens: 1500,
      });

      if (usedLocal) usedLocalModel = true;

      const parsedAngles = JSON.parse(completion.choices[0]?.message?.content || '{}');
      if (Array.isArray(parsedAngles.angles) && parsedAngles.angles.length > 0) {
        angles = parsedAngles.angles
          .filter((angle: Partial<AngleDefinition>) => angle && typeof angle.claim === 'string')
          .map((angle: Partial<AngleDefinition>) => ({
            ...angle,
            mode: mode === 'both' ? (angle.mode === 'rebuttal' ? 'rebuttal' : 'contention') : mode,
            side: angle.side === 'NEG' ? 'NEG' : 'AFF',
            role: typeof angle.role === 'string' ? angle.role : (mode === 'rebuttal' ? 'Rebuttal Answer' : 'Constructive Case'),
            searchQueries: Array.isArray(angle.searchQueries) ? angle.searchQueries.filter((query): query is string => typeof query === 'string') : [],
          } as AngleDefinition));
      }
    } catch (e) {
      if (isRateLimitError(e)) throw e;
      console.warn('Angle formulation AI call failed:', e);
    }

    if (angles.length === 0) {
      if (mode === 'contention' || mode === 'both') {
        angles.push(
          {
            mode: 'contention',
            side: 'AFF',
            claim: `${trimmedTopic} causes significant economic and humanitarian benefits`,
            role: '1AC Core Advantage',
            searchQueries: [`"${trimmedTopic}" benefits empirical study`, `${trimmedTopic} economic impact report`],
          },
          {
            mode: 'contention',
            side: 'NEG',
            claim: `${trimmedTopic} creates severe unintended economic or geopolitical disruption`,
            role: '1NC Core Disadvantage',
            searchQueries: [`"${trimmedTopic}" drawbacks risks study`, `${trimmedTopic} unintended consequences report`],
          }
        );
      }
      if (mode === 'rebuttal' || mode === 'both') {
        angles.push(
          {
            mode: 'rebuttal',
            side: 'NEG',
            claim: `Turn: ${trimmedTopic} fails to solve root causes and exacerbates status quo problems`,
            role: 'Solvency Takeout & Turn',
            searchQueries: [`"${trimmedTopic}" ineffective failure empirical`, `${trimmedTopic} solvency takeout`],
          },
          {
            mode: 'rebuttal',
            side: 'AFF',
            claim: `Defense: Status quo safeguards and resilience prevent alleged risks of ${trimmedTopic}`,
            role: 'Impact Defense & Non-Unique',
            searchQueries: [`"${trimmedTopic}" risks overstated defense study`, `${trimmedTopic} safeguards mitigate harms`],
          }
        );
      }
    }

    const scrapedArticles: Array<{ article: ScrapedArticle; angle: AngleDefinition }> = [];
    const seenUrls = new Set(excludeUrls.map((url) => url.toLowerCase().replace(/\/+$/, '')));

    if (customText && customText.trim().length > 100) {
      const customArticle: ScrapedArticle = {
        url: 'User Pasted Source',
        title: 'Custom User Text',
        text: cleanText(customText),
      };
      angles.forEach((angle) => {
        scrapedArticles.push({ article: customArticle, angle });
      });
    }

    if (scrapedArticles.length < angles.length) {
      const sourcesPerAngle = Math.max(1, Math.ceil(cardCount / angles.length));
      for (const angle of angles) {
        for (const query of angle.searchQueries.slice(0, 2)) {
          for (let pageOffset = 0; pageOffset < 3; pageOffset += 1) {
            const searchHits = await searchWebForQuery(
              cycle > 0 ? `${query} research report study` : query,
              Math.max(3, sourcesPerAngle + 2),
              cycle + pageOffset
            );
            for (const hit of searchHits) {
              const normalizedUrl = hit.url.toLowerCase().replace(/\/+$/, '');
              if (seenUrls.has(normalizedUrl)) continue;
              seenUrls.add(normalizedUrl);
              const scraped = await scrapeUrl(hit.url);
              if (scraped && scraped.text.length >= 200) {
                scrapedArticles.push({ article: scraped, angle });
                const angleSourceCount = scrapedArticles.filter((item) => item.angle === angle).length;
                if (angleSourceCount >= sourcesPerAngle || scrapedArticles.length >= cardCount) break;
              }
            }
            if (
              scrapedArticles.filter((item) => item.angle === angle).length >= sourcesPerAngle ||
              scrapedArticles.length >= cardCount
            ) break;
          }
          if (scrapedArticles.filter((item) => item.angle === angle).length >= sourcesPerAngle) break;
        }
        if (scrapedArticles.length >= cardCount) break;
      }
    }

    // Cut Tech Debate Cards from discovered sources
    for (let i = 0; i < scrapedArticles.length && cards.length < cardCount; i++) {
      const { article, angle } = scrapedArticles[i];

      const citation = formatSourceCitation(article);

      const cuttingPrompt = `You are an elite Tech Debate Card Cutter.
Cut a competition-ready debate card from this article text.

Debate Topic: "${trimmedTopic}"
Card Mode: "${angle.mode.toUpperCase()}" (${angle.mode === 'contention' ? 'Constructive Case Card' : 'Rebuttal Response Card'})
Side: "${angle.side}"
Target Argument: "${angle.claim}"
Role: "${angle.role}"

${angle.mode === 'rebuttal' ? `REBUTTAL REQUIREMENT: This card must answer an opponent contention, not introduce a standalone case contention. The highlights must make the opponent's claim and the evidence-based response clear. Prefer a direct takeout, non-uniqueness answer, no-link/no-solvency answer, impact defense, or turn. The tag and strategy advice must describe that response.` : 'CONTENTION REQUIREMENT: This card should support a constructive case argument.'}

TECH DEBATE CUTTING RULES:
1. PRESERVE THE WHOLE ARTICLE / PASSAGE: Keep the entire text from this source passage intact.
2. NEON BLUE HIGHLIGHTS (<mark>): Debaters speed-read ONLY the highlights. For rebuttals, the highlights must explain the opponent claim and evidence-based answer; for contentions, explain the argument from claim through warrant, data, and impact.
3. PSEUDO-ENGLISH / TELEGRAPHIC HIGHLIGHTS: Highlights should be telegraphic and cut filler words so reading ONLY the highlighted words gives a rapid, understandable argument.
4. UNDERLINES (<u>): Underline surrounding context (methodology, nuances, qualifiers) outside <mark>.
5. UNREAD TEXT: All other unhighlighted text remains in the card as small background text.
6. TAG: Prefix with "[${angle.side} - ${angle.mode.toUpperCase()}]".
7. Select one to three complete, contiguous sentences copied exactly from the source for highlightQuotes. Preserve the author's words and qualifiers without paraphrasing or combining text.
8. Use underlineQuotes only for exact source context needed to understand the highlighted warrant.
9. Do not invent citations, author names, dates, URLs, or qualifications; the server derives these from the source.

SOURCE TEXT:
${article.text.slice(0, 10000)}

Respond ONLY with valid JSON:
{
  "tag": "[${angle.side} - ${angle.mode.toUpperCase()}] Punchy tagline summarizing what the highlights prove",
  "highlightQuotes": ["exact contiguous source passage"],
  "underlineQuotes": ["exact supporting context, if needed"],
  "type": "${angle.side}",
  "warrant": "1-sentence summary of the core warrant",
  "strategyAdvice": "How to deploy this card in round"
}`;

      try {
        const { completion, usedLocal } = await runChatCompletionWithFallback(aiConfig, {
          messages: [{ role: 'user', content: cuttingPrompt }],
          response_format: { type: 'json_object' },
          temperature: 0.15,
          max_tokens: 3000,
        });

        if (usedLocal) usedLocalModel = true;

        const parsedCut = JSON.parse(completion.choices[0]?.message?.content || '{}') as RawCutCard;

        const bodyHtml = formatSourceGroundedCard(
          article.text,
          parsedCut.highlightQuotes ?? [],
          parsedCut.underlineQuotes ?? []
        ) || formatSourceGroundedCard(
          article.text,
          buildSourceGroundedFallbackQuotes(article.text, `${trimmedTopic} ${angle.claim} ${angle.role}`, 2)
        );
        if (bodyHtml) {
          const cleanBody = emphasizeReadAloudKeywords(bodyHtml);
          const textOnly = cleanBody.replace(/<[^>]+>/g, '').trim();

          if (!seenBodies.has(textOnly)) {
            seenBodies.add(textOnly);
            cards.push({
              id: `topic_card_${Date.now()}_${i}`,
              contention: angle.claim,
              tag: parsedCut.tag || `[${angle.side} - ${angle.mode.toUpperCase()}] ${angle.claim}`,
              citation,
              bodyHtml: cleanBody,
              type: angle.side,
              cardMode: angle.mode,
              reasoning: parsedCut.strategyAdvice || parsedCut.warrant || (angle.mode === 'rebuttal' ? `Answers opponent claim: ${angle.claim}` : `Supports constructive case: ${angle.claim}`),
              sourceTitle: article.title,
              sourceUrl: article.url.startsWith('http') ? article.url : undefined,
              author: article.author,
              authorQualifications: article.authorQualifications,
              strategyTarget: angle.role,
            });
          }
        }
      } catch (cutErr) {
        if (isRateLimitError(cutErr)) throw cutErr;
        console.warn('AI card cut attempt failed; using exact-source fallback:', cutErr);
        const fallbackBody = formatSourceGroundedCard(
          article.text,
          buildSourceGroundedFallbackQuotes(article.text, `${trimmedTopic} ${angle.claim} ${angle.role}`, 2)
        );
        if (fallbackBody) {
          const textOnly = fallbackBody.replace(/<[^>]+>/g, '').trim();
          if (!seenBodies.has(textOnly)) {
            seenBodies.add(textOnly);
            cards.push({
              id: `topic_card_${Date.now()}_${i}_source_fallback`,
              contention: angle.claim,
              tag: `[${angle.side} - ${angle.mode.toUpperCase()}] Evidence relevant to ${angle.claim.slice(0, 100)}`,
              citation,
              bodyHtml: emphasizeReadAloudKeywords(fallbackBody),
              type: angle.side,
              cardMode: angle.mode,
              reasoning: `Exact source passage selected as a fallback after the model could not cut this source. Strategy: ${angle.role}.`,
              sourceTitle: article.title,
              sourceUrl: article.url.startsWith('http') ? article.url : undefined,
              author: article.author,
              authorQualifications: article.authorQualifications,
              strategyTarget: angle.role,
            });
          }
        }
      }
    }

    const reviewedCards = await reviewTopicCards(cards);
    return NextResponse.json({
      topic: trimmedTopic,
      mode,
      cards: reviewedCards,
      angles,
      count: reviewedCards.length,
      usedLocalModel,
      notice: usedLocalModel
        ? `${reviewedCards.length} cards passed relevance and tag review using the local model.`
        : reviewedCards.length === 0
          ? cards.length > 0
            ? 'Sources were found, but no card passed evidence relevance and tag-accuracy review. Try adjusting the topic or broadening the search.'
            : 'No cards could be cut from the discovered sources. Try adjusting your topic phrasing.'
          : 'Cards were independently reviewed for relevance and accurate tags.',
      sourceUrls: scrapedArticles
        .map(({ article }) => article.url)
        .filter((url) => /^https?:\/\//i.test(url)),
    });
  } catch (error: unknown) {
    console.error('Topic cards API error:', error);
    const message = error instanceof Error ? error.message : 'Unknown topic card cutting error';
    return NextResponse.json({ error: message, quotaExhausted: isRateLimitError(error) }, { status: isRateLimitError(error) ? 429 : 500 });
  }
}
