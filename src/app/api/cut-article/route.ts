import { NextResponse } from 'next/server';
import * as cheerio from 'cheerio';
import { runChatCompletionWithFallback, AiConfigOptions } from '../../../lib/aiProvider';
import { isBannedUrl, getBannedUrlMessage } from '../../../lib/domainFilters';
import { formatSourceCitation, formatSourceGroundedCard } from '../../../lib/sourceGroundedCards';

interface CutArticleRequest {
  url?: string;
  articleText?: string;
  topic?: string;
  focusClaim?: string;
  cardType?: string;
  density?: 'tech' | 'lay';
  count?: number;
  providerMode?: 'cloud' | 'local' | 'auto';
  providerType?: 'auto' | 'grok' | 'openai' | 'groq' | 'openrouter' | 'deepseek' | 'custom' | 'local';
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  localBaseUrl?: string;
  localModel?: string;
  localApiKey?: string;
  groqApiKeys?: string[];
  apiKeyIndex?: number;
  excludePassages?: string[];
}

interface CutCardOutput {
  tag?: string;
  highlightQuotes?: string[];
  underlineQuotes?: string[];
  type?: string;
  warrant?: string;
}

const VALID_CARD_TYPES = new Set(['AFF', 'NEG', 'NQ', 'NL', 'DL', 'T']);

function cleanArticleText(value: string): string {
  return value
    .replace(/\u00a0/g, ' ')
    .replace(/\r\n?/g, '\n')
    .trim();
}

function extractArticleText($: cheerio.CheerioAPI): string {
  const articleRoot = $('article, main, [role="main"]').first();
  const root = articleRoot.length ? articleRoot : $('body');
  const extractedParts: string[] = [];
  root.find('p, h1, h2, h3, h4, h5, h6, li, figcaption, td, th').each((_, element) => {
    const text = $(element).text().replace(/\s+/g, ' ').trim();
    if (text) extractedParts.push(text);
  });
  return extractedParts.join('\n\n') || root.text().replace(/\s+/g, ' ').trim();
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

export async function POST(req: Request) {
  try {
    const body: CutArticleRequest = await req.json();
    const {
      url,
      articleText,
      topic = '',
      focusClaim = '',
      cardType = 'AUTO',
      density = 'tech',
      providerMode = 'auto',
      providerType = 'auto',
      apiKey,
      baseUrl,
      model,
      localBaseUrl,
      localModel,
      localApiKey,
      groqApiKeys = [],
      apiKeyIndex = 0,
      excludePassages = [],
    } = body;

    if (!url && (!articleText || !articleText.trim())) {
      return NextResponse.json({ error: 'Please provide either a URL or raw article text.' }, { status: 400 });
    }

    let title = 'Pasted Article';
    let author: string | undefined;
    let authorQualifications: string | undefined;
    let publishedDate: string | undefined;
    let contentToCut = articleText ? articleText.trim() : '';

    if (url && url.trim() && !articleText?.trim()) {
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(url.trim());
      } catch {
        return NextResponse.json({ error: 'Please provide a valid article URL.' }, { status: 400 });
      }
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        return NextResponse.json({ error: 'Article URLs must use http or https.' }, { status: 400 });
      }
      if (isBannedUrl(url)) {
        return NextResponse.json({ error: getBannedUrlMessage(url) }, { status: 400 });
      }

      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        signal: AbortSignal.timeout(15000),
      });

      if (!res.ok) {
        return NextResponse.json({ error: `Failed to fetch URL: ${res.statusText}` }, { status: 400 });
      }

      const html = await res.text();
      const $ = cheerio.load(html);
      title = cleanMetadataValue($('meta[property="og:title"]').attr('content')) || cleanMetadataValue($('title').text()) || url;
      ({ author, qualifications: authorQualifications, publishedDate } = extractAuthorDetails($));

      $('script, style, noscript, nav, header, footer, aside, .sidebar, .ad').remove();

      contentToCut = extractArticleText($);
    } else if (url?.trim()) {
      try {
        title = new URL(url.trim()).hostname.replace(/^www\./, '');
      } catch {
        return NextResponse.json({ error: 'Please provide a valid article URL.' }, { status: 400 });
      }
    }

    contentToCut = cleanArticleText(contentToCut);

    if (!contentToCut || contentToCut.length < 50) {
      return NextResponse.json({ error: 'Not enough text content found to cut a card.' }, { status: 400 });
    }

    const standardCitation = formatSourceCitation({
      author,
      authorQualifications,
      publishedDate,
      title,
      url: url?.trim(),
    });

    const requestedCardType = cardType.toUpperCase();
    const automaticCardType = requestedCardType === 'AUTO';
    const fixedCardType = VALID_CARD_TYPES.has(requestedCardType) ? requestedCardType : 'AFF';
    const defaultTag = `[${fixedCardType}] ${focusClaim || topic || title}`;

    const excludedText = excludePassages.length
      ? `\n\nPASSAGES ALREADY CUT (do not reuse or paraphrase these; find different evidence):\n${excludePassages.map((passage, index) => `${index + 1}. ${passage}`).join('\n')}`
      : '';

    const densityNote = density === 'tech'
      ? 'DENSE CIRCUIT STYLE: Identify nuanced empirical warrants, technical causal links, and specific data.'
      : 'LAY/PARENT STYLE: Identify high-clarity, intuitive, punchy warrants that a lay judge will immediately grasp.';

    const cardTypeInstructions = automaticCardType
      ? `Choose the single best card type for this evidence. Allowed types: AFF (affirmative/pro-plan support), NEG (negative/against-plan support), NQ (non-unique: the harm already exists or the uniqueness claim is false), NL (no link: the plan does not cause the claimed effect), DL (link turn: the plan causes the opposite effect), or T (topicality). Return your choice in the "type" field and prefix the tag with that type.`
      : `Use the requested card type "${fixedCardType}" and prefix the tag with that type.`;

    const systemPrompt = `You are an elite competitive debate evidence cutter for policy, Lincoln-Douglas, and Public Forum debate.
${densityNote}
The final evidence card must preserve the supplied article verbatim. Your job is to select exact passages for read-aloud emphasis and supporting context.

RULES:
1. Cut ONE card from the full article for this target claim.
2. highlightQuotes: 1–3 consecutive, complete sentences that form the strongest grammatical read-aloud warrant. It must directly prove the tag, preserve qualifiers, and make sense when read by itself.
3. underlineQuotes: The shortest additional exact context needed to establish setup, mechanism, comparison, or impact.
4. Do not highlight background or sentences that do not prove the claim.
5. Every selection must be copied EXACTLY and continuously from the article.
6. Tag: A concise, faithful argumentative claim. ${cardTypeInstructions}

Return JSON only in this shape:
{"type":"${automaticCardType ? 'AFF, NEG, NQ, NL, DL, or T' : fixedCardType}","tag":"[TYPE] faithful tag","highlightQuotes":["one exact read-aloud passage"],"underlineQuotes":["one exact supporting passage, if needed"],"warrant":"one sentence explaining how the highlighted words prove the tag"}`;

    const userPrompt = `Debate Topic: "${topic || 'Competitive Debate'}"
Target Claim / Contention: "${focusClaim || 'Cut the strongest tournament-ready evidence from this article'}"
Card Type: "${automaticCardType ? 'Choose the best type from the evidence' : fixedCardType}"

FULL ARTICLE:
${contentToCut.slice(0, 20000)}${excludedText}`;

    const resolvedApiKey = apiKey || groqApiKeys[apiKeyIndex] || groqApiKeys[0];

    const aiConfig: AiConfigOptions = {
      providerMode,
      providerType,
      apiKey: resolvedApiKey,
      baseUrl,
      model,
      localBaseUrl,
      localModel,
      localApiKey,
      fallbackOnRateLimit: false,
      density,
    };

    let generatedCards: Array<{ tag: string; bodyHtml: string; warrant: string; type: string }> = [];
    let usedLocalModel = false;
    let modelUsedName = '';

    try {
      const { completion, usedLocal, modelUsed } = await runChatCompletionWithFallback(aiConfig, {
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.15,
        max_tokens: 2200,
      });

      usedLocalModel = usedLocal;
      modelUsedName = modelUsed;
      const parsed = JSON.parse(completion.choices[0]?.message?.content || '{}') as CutCardOutput;
      const highlightQuotes = Array.isArray(parsed.highlightQuotes) ? parsed.highlightQuotes : [];
      const underlineQuotes = Array.isArray(parsed.underlineQuotes) ? parsed.underlineQuotes : [];
      const bodyHtml = formatSourceGroundedCard(contentToCut, highlightQuotes, underlineQuotes);
      const generatedCardType = automaticCardType
        ? parsed.type?.toUpperCase()
        : fixedCardType;

      if (!bodyHtml) {
        throw new Error('The AI did not return an exact, source-verbatim evidence passage. Try cutting the card again.');
      }
      if (!generatedCardType || !VALID_CARD_TYPES.has(generatedCardType)) {
        throw new Error('The AI did not return a valid card type. Try cutting the card again.');
      }
      
      const parsedTag = parsed.tag?.replace(/^\[(AFF|NEG|NQ|NL|DL|T)\]\s*/i, '').trim();
      const tag = parsedTag ? `[${generatedCardType}] ${parsedTag}` : `[${generatedCardType}] ${focusClaim || topic || title}`;
      generatedCards = [{
        tag: tag || defaultTag,
        bodyHtml,
        warrant: parsed.warrant || 'Highlighted evidence directly supports the target claim.',
        type: generatedCardType,
      }];
    } catch (modelError) {
      const status = modelError && typeof modelError === 'object' && 'status' in modelError ? modelError.status : undefined;
      if (status === 429) throw modelError;
      console.error('AI card cut failed:', modelError);
      throw modelError;
    }

    const cards = generatedCards.map((card, index) => ({
      id: `cut_${Date.now()}_${index}`,
      contention: focusClaim || topic || 'Article Evidence Cut',
      tag: card.tag,
      citation: standardCitation,
      bodyHtml: card.bodyHtml,
      type: card.type,
      reasoning: card.warrant,
      sourceTitle: title,
      sourceUrl: url?.trim() || undefined,
      author,
      authorQualifications,
      publishedDate,
    }));

    return NextResponse.json({
      cards,
      card: cards[0],
      usedLocalModel,
      modelUsed: modelUsedName,
      notice: usedLocalModel ? 'Cut using Local Open-Weight Model.' : undefined,
    });
  } catch (error: unknown) {
    console.error('Cut article route error:', error);
    const status = error && typeof error === 'object' && 'status' in error ? error.status : undefined;
    const message = status === 413
      ? 'This article is longer than the AI model can process in one pass. No text was truncated; use a model with a larger context window.'
      : error instanceof Error ? error.message : 'Unknown article cutting error';
    return NextResponse.json({ error: message, quotaExhausted: status === 429 }, { status: status === 429 || status === 413 ? status : 500 });
  }
}
