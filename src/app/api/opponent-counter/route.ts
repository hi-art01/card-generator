import { NextResponse } from 'next/server';
import google from 'googlethis';
import * as cheerio from 'cheerio';
import { createAiClient, AiProviderMode, AiProviderType } from '../../../lib/aiProvider';
import {
  buildEvidenceFallback,
  isEvidenceFromSource,
  normalizeEvidenceText,
  sanitizeEvidenceHtml,
} from '../../../lib/evidence';

interface OpponentCounterRequest {
  opponentCase?: string;
  userDeposit?: string;
  topic?: string;
  groqApiKeys?: string[];
  providerMode?: AiProviderMode;
  providerType?: AiProviderType;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  localBaseUrl?: string;
  localModel?: string;
  localApiKey?: string;
}

const STRATEGY_TYPES = ['Non-Uniqueness', 'No-Link', 'Solvency Turn', 'Impact Turn', 'Disad Counter'] as const;
type StrategyType = (typeof STRATEGY_TYPES)[number];

function getTextField(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function getStrategyType(value: unknown): StrategyType {
  return STRATEGY_TYPES.includes(value as StrategyType) ? (value as StrategyType) : 'No-Link';
}

export async function POST(req: Request) {
  try {
    const {
      opponentCase,
      userDeposit = '',
      topic = '',
      groqApiKeys = [],
      providerMode,
      providerType,
      apiKey: directApiKey,
      baseUrl,
      model: requestedModel,
      localBaseUrl,
      localModel,
      localApiKey,
    }: OpponentCounterRequest = await req.json();

    if (!opponentCase || !opponentCase.trim()) {
      return NextResponse.json({ error: 'Opponent case text is required.' }, { status: 400 });
    }

    const trimmedCase = opponentCase.trim();
    const trimmedDeposit = userDeposit.trim();
    if (trimmedCase.length < 120) {
      return NextResponse.json(
        { error: 'Please provide at least a short paragraph from the opponent case.' },
        { status: 400 }
      );
    }

    const keyToUse =
      directApiKey?.trim() ||
      (groqApiKeys
        .filter((k): k is string => typeof k === 'string' && Boolean(k.trim()))
        .map((k) => k.trim())[0] ||
        undefined);

    const { client: ai, model } = createAiClient({
      providerMode,
      providerType,
      apiKey: keyToUse,
      baseUrl,
      model: requestedModel,
      localBaseUrl,
      localModel,
      localApiKey,
    });

    // 1. Analyze opponent case to identify core claims
    const analysisRes = await ai.chat.completions.create({
      model,
      messages: [
        {
          role: 'system',
          content: `You are a chief debate strategist. Analyze the opponent's case and break down their main contentions, uniqueness claims, links, and impacts. Use only claims stated in the supplied case. Return at most five material contentions.
OUTPUT FORMAT: JSON ONLY:
{
  "contentions": [
    {
      "title": "Contention Title",
      "uniqueness": "Status quo claim",
      "link": "Mechanism/policy action",
      "impact": "Harm or benefit claimed",
      "searchQueries": ["query 1 for counter cards", "query 2 for counter cards"]
    }
  ]
}`,
        },
        {
          role: 'user',
          content: `Topic: ${topic.slice(0, 300)}\nOpponent Case:\n${trimmedCase.slice(0, 12000)}`,
        },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1,
    });

    const parsedAnalysis = JSON.parse(analysisRes.choices[0]?.message?.content || '{}') as Record<string, unknown>;
    const contentions = Array.isArray(parsedAnalysis.contentions)
      ? parsedAnalysis.contentions
          .filter((contention): contention is Record<string, unknown> => Boolean(contention && typeof contention === 'object'))
          .map((contention) => ({
            title: getTextField(contention.title, 180),
            uniqueness: getTextField(contention.uniqueness, 600),
            link: getTextField(contention.link, 600),
            impact: getTextField(contention.impact, 600),
            searchQueries: Array.isArray(contention.searchQueries)
              ? contention.searchQueries
                  .filter((query): query is string => typeof query === 'string' && query.trim().length > 4)
                  .slice(0, 2)
              : [],
          }))
          .filter((contention) => contention.title && (contention.link || contention.impact || contention.uniqueness))
          .slice(0, 5)
      : [];

    if (contentions.length === 0) {
      return NextResponse.json(
        { error: 'Could not identify a usable contention. Paste more of the opponent case or include clearer claim text.' },
        { status: 422 }
      );
    }

    const counterBlocks: Array<{
      contentionTitle: string;
      strategy: string;
      cards: Array<{
        id: string;
        tag: string;
        citation: string;
        bodyHtml: string;
        type: string;
        strategyType: 'Non-Uniqueness' | 'No-Link' | 'Solvency Turn' | 'Impact Turn' | 'Disad Counter';
        source: string;
      }>;
    }> = [];

    // 2. If user provided their own deposit, attempt to match user cards first
    let userMatchedCards: Array<{
      tag: string;
      citation: string;
      bodyHtml: string;
      type: string;
      strategyType: 'Non-Uniqueness' | 'No-Link' | 'Solvency Turn' | 'Impact Turn' | 'Disad Counter';
      targetContention: string;
    }> = [];

    if (trimmedDeposit.length > 100) {
      try {
        const depositMatchRes = await ai.chat.completions.create({
          model,
          messages: [
            {
              role: 'system',
              content: `You are a debate prepper matching cards from a user's deposit against opponent contentions.
For each opponent contention, extract any relevant counter cards found in the user deposit text.
Highlight warrants with <mark>...</mark> and underline context with <u>...</u>.
OUTPUT JSON ONLY:
{
  "matchedCards": [
    {
      "targetContention": "Contention Title",
      "tag": "Tag line",
      "citation": "Citation",
      "bodyHtml": "Body quote with <mark> and <u>",
      "type": "NEG or AFF",
      "strategyType": "Non-Uniqueness | No-Link | Solvency Turn | Impact Turn | Disad Counter"
    }
  ]
}`,
            },
            {
              role: 'user',
              content: `Opponent Contentions: ${JSON.stringify(contentions)}\nUser Card Deposit:\n${trimmedDeposit.slice(0, 10000)}`,
            },
          ],
          response_format: { type: 'json_object' },
          temperature: 0.1,
        });
        const parsedUserMatch = JSON.parse(depositMatchRes.choices[0]?.message?.content || '{}') as Record<string, unknown>;
        userMatchedCards = Array.isArray(parsedUserMatch.matchedCards)
          ? parsedUserMatch.matchedCards
              .filter((card): card is Record<string, unknown> => Boolean(card && typeof card === 'object'))
              .map((card) => ({
                targetContention: getTextField(card.targetContention, 180),
                tag: getTextField(card.tag, 240),
                citation: getTextField(card.citation, 500),
                bodyHtml: sanitizeEvidenceHtml(card.bodyHtml),
                type: getTextField(card.type, 20),
                strategyType: getStrategyType(card.strategyType),
              }))
              .filter((card) => card.targetContention && card.bodyHtml && isEvidenceFromSource(card.bodyHtml, trimmedDeposit))
              .slice(0, 12)
          : [];
      } catch (e) {
        console.error('Failed to match user deposit cards', e);
      }
    }

    // 3. For each contention, search online debate depositories (Open Case List, Debatify, Logos, PrepSync) for counter cards
    for (let cIdx = 0; cIdx < contentions.length; cIdx++) {
      const contention = contentions[cIdx];
      const contentionCards: Array<{
        id: string;
        tag: string;
        citation: string;
        bodyHtml: string;
        type: string;
        strategyType: 'Non-Uniqueness' | 'No-Link' | 'Solvency Turn' | 'Impact Turn' | 'Disad Counter';
        source: string;
      }> = [];

      // Add user deposit matches for this contention
      const userMatches = userMatchedCards.filter(
        (uc) =>
          uc.targetContention.toLowerCase().includes(contention.title.toLowerCase()) ||
          contention.title.toLowerCase().includes(uc.targetContention.toLowerCase())
      );
      userMatches.forEach((um, uIdx) => {
        contentionCards.push({
          id: `user_cntr_${cIdx}_${uIdx}`,
          tag: um.tag || `Counter to ${contention.title}`,
          citation: um.citation || 'User card deposit',
          bodyHtml: um.bodyHtml,
          type: um.type === 'AFF' || um.type === 'NEG' ? um.type : 'NEG',
          strategyType: um.strategyType,
          source: 'User Card Deposit',
        });
      });

      // Search online depositories for live counter cards
      const queries = contention.searchQueries || [
        `${contention.link} refutation debate card`,
        `${contention.impact} turn debate card`,
      ];
      const searchQuery = `${queries[0]} (site:opencaselist.com OR site:debatify.io OR site:logos.college OR site:prepsync.com)`;

      try {
        const gRes = await google.search(searchQuery, { page: 0, safe: false });
        if (gRes.results && gRes.results.length > 0) {
          for (let rIdx = 0; rIdx < Math.min(gRes.results.length, 2); rIdx++) {
            const item = gRes.results[rIdx];
            let sourceName = 'Open Case List';
            if (item.url.includes('debatify')) sourceName = 'Debatify';
            else if (item.url.includes('logos')) sourceName = 'Logos';
            else if (item.url.includes('prepsync')) sourceName = 'Online Debate Archive';

            let articleText = item.description || '';
            try {
              const fetchRes = await fetch(item.url, {
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
                signal: AbortSignal.timeout(4000),
              });
              if (fetchRes.ok) {
                const html = await fetchRes.text();
                const $ = cheerio.load(html);
                $('script, style, noscript, nav, header, footer').remove();
                articleText = normalizeEvidenceText($('body').text()).slice(0, 4500);
              }
            } catch {
              // fallback to description
            }

            if (articleText.length > 100) {
              const cardCut = await ai.chat.completions.create({
                model,
                messages: [
                  {
                    role: 'system',
                    content: `Cut a direct counter card against this contention link/impact: "${contention.link} ${contention.impact}".
Highlight warrants with <mark>...</mark> and underline context with <u>...</u>.
OUTPUT JSON ONLY:
{
  "tag": "Tag line",
  "citation": "Citation line",
  "bodyHtml": "Body quote with <mark> and <u>",
  "type": "NEG",
  "strategyType": "Non-Uniqueness | No-Link | Solvency Turn | Impact Turn | Disad Counter"
}`,
                  },
                  {
                    role: 'user',
                    content: `URL: ${item.url}\nText:\n${articleText}`,
                  },
                ],
                response_format: { type: 'json_object' },
                temperature: 0.1,
              });

              const parsedCard = JSON.parse(cardCut.choices[0]?.message?.content || '{}') as Record<string, unknown>;
              const cleanedBody = sanitizeEvidenceHtml(parsedCard.bodyHtml);
              const bodyHtml = isEvidenceFromSource(cleanedBody, articleText)
                ? cleanedBody
                : buildEvidenceFallback(articleText, `${contention.link} ${contention.impact}`);
              if (bodyHtml) {
                contentionCards.push({
                  id: `live_cntr_${cIdx}_${rIdx}`,
                  tag: getTextField(parsedCard.tag, 240) || `Refutation card: ${contention.title}`,
                  citation: getTextField(parsedCard.citation, 500) || `${item.title} (${item.url})`,
                  bodyHtml,
                  type: parsedCard.type === 'AFF' || parsedCard.type === 'NEG' ? parsedCard.type : 'NEG',
                  strategyType: getStrategyType(parsedCard.strategyType),
                  source: sourceName,
                });
              }
            }
          }
        }
      } catch (e) {
        console.error('Online search for counter card failed', e);
      }

      // If no cards were found online or from deposit, synthesize a strategic refutation card
      if (contentionCards.length === 0) {
        try {
          const synthRes = await ai.chat.completions.create({
            model,
            messages: [
              {
                role: 'system',
                content: `You are a national championship debate coach. Generate a high-potency strategic refutation card / argument against this contention link and impact:
Target Link: "${contention.link}"
Target Impact: "${contention.impact}"
Highlight warrants with <mark>...</mark> and underline context with <u>...</u>.
OUTPUT JSON ONLY:
{
  "tag": "Sharp debate tag",
  "citation": "Credible analytical evidence citation",
  "bodyHtml": "Analytical warrant with <mark> and <u>",
  "type": "NEG",
  "strategyType": "No-Link | Solvency Turn | Non-Uniqueness"
}`,
              },
              {
                role: 'user',
                content: `Topic: ${topic}\nContention: ${contention.title}`,
              },
            ],
            response_format: { type: 'json_object' },
            temperature: 0.2,
          });
          const synthParsed = JSON.parse(synthRes.choices[0]?.message?.content || '{}') as Record<string, unknown>;
          if (synthParsed.tag && synthParsed.bodyHtml) {
            contentionCards.push({
              id: `synth_cntr_${cIdx}`,
              tag: getTextField(synthParsed.tag, 240),
              citation: getTextField(synthParsed.citation, 500) || 'Debate Strategic Analysis (2025)',
              bodyHtml: sanitizeEvidenceHtml(synthParsed.bodyHtml),
              type: 'NEG',
              strategyType: getStrategyType(synthParsed.strategyType),
              source: 'AI Strategic Prepper',
            });
          }
        } catch (synthErr) {
          console.error('Synthesis fallback failed', synthErr);
        }
      }

      counterBlocks.push({
        contentionTitle: contention.title,
        strategy: `Target ${contention.title}: Attack link mechanism ("${contention.link}") with No-Link and Solvency Turn cards. Rebut impact ("${contention.impact}") with Impact Turn and Non-Uniqueness.`,
        cards: contentionCards,
      });
    }

    return NextResponse.json({
      opponentCaseSummary: `Parsed ${contentions.length} core contention(s) from opponent case.`,
      contentions,
      counterBlocks,
      modelUsed: model,
    });
  } catch (error: unknown) {
    console.error('Opponent counter route error:', error);
    const message = error instanceof Error ? error.message : 'Unknown counter card generation error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
