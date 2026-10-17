import { NextResponse } from 'next/server';
import { createAiClient, AiProviderMode, AiProviderType } from '../../../lib/aiProvider';

interface RankingRequestBody {
  topic?: string;
  contention?: string;
  targetText?: string;
  targetMode?: 'Attack' | 'Support' | 'Defend';
  targetSide?: 'Affirmative' | 'Negative' | 'Support';
  type?: 'AFF' | 'NEG' | 'NQ' | 'NL' | 'DL' | 'T';
  tag?: string;
  citation?: string;
  bodyHtml?: string;
  reasoning?: string;
  groqApiKeys?: string[];
  groqApiKey?: string;
  providerMode?: AiProviderMode;
  providerType?: AiProviderType;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  localBaseUrl?: string;
  localModel?: string;
  localApiKey?: string;
}

interface CardQualityRating {
  score: number;
  label: string;
  rationale: string;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ');
}

function extractMarkedText(html: string): string {
  const marks = [...html.matchAll(/<mark[^>]*>([\s\S]*?)<\/mark>/gi)];
  return normalizeWhitespace(
    marks
      .map((match) => stripHtml(match[1] ?? ''))
      .join(' ')
  );
}

function extractJsonObject(rawValue: string): unknown {
  const withoutFence = rawValue
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim();
  const objectMatch = withoutFence.match(/\{[\s\S]*\}/);
  const jsonText = objectMatch ? objectMatch[0] : withoutFence;

  return JSON.parse(jsonText);
}

function normalizeRatingPayload(payload: unknown): CardQualityRating | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const rawScore = typeof record.score === 'number' ? record.score : Number(record.score);

  if (!Number.isFinite(rawScore)) {
    return null;
  }

  const score = Math.min(10, Math.max(1, Math.round(rawScore)));
  const label =
    typeof record.label === 'string' && record.label.trim()
      ? record.label.trim().slice(0, 60)
      : score >= 8
        ? 'Strong card'
        : score >= 5
          ? 'Usable card'
          : 'Weak card';
  const rationale =
    typeof record.rationale === 'string' && record.rationale.trim()
      ? record.rationale.trim().slice(0, 220)
      : 'No rationale returned.';

  return { score, label, rationale };
}

export async function POST(req: Request) {
  try {
    const {
      topic,
      contention,
      targetText,
      targetMode,
      targetSide,
      type,
      tag,
      citation,
      bodyHtml,
      reasoning,
      groqApiKeys,
      groqApiKey,
      providerMode,
      providerType,
      apiKey,
      baseUrl,
      model: requestedModel,
      localBaseUrl,
      localModel,
      localApiKey,
    }: RankingRequestBody = await req.json();

    if (!bodyHtml || !citation) {
      return NextResponse.json(
        { error: 'Missing required fields for card ranking generation.' },
        { status: 400 }
      );
    }

    const keyToUse =
      apiKey?.trim() ||
      groqApiKey?.trim() ||
      (groqApiKeys && groqApiKeys.length > 0 ? groqApiKeys[0].trim() : undefined);

    const { client, model } = createAiClient({
      providerMode,
      providerType,
      apiKey: keyToUse,
      baseUrl,
      model: requestedModel,
      localBaseUrl,
      localModel,
      localApiKey,
    });

    const evidenceText = normalizeWhitespace(stripHtml(bodyHtml));
    const highlightedText = extractMarkedText(bodyHtml);

    const userPrompt = [
      `Topic: ${topic?.trim() || 'Unknown topic'}`,
      `Contention: ${contention?.trim() || 'Unknown contention'}`,
      `Original target wording: ${targetText?.trim() || 'Not provided'}`,
      `Target mode: ${targetMode || 'Unknown'}`,
      `Target side: ${targetSide || 'Unknown'}`,
      `Card type: ${type || 'Unknown'}`,
      `Current tag: ${tag?.trim() || 'No tag yet'}`,
      `Citation: ${citation.trim()}`,
      `Reasoning notes: ${reasoning?.trim() || 'None provided'}`,
      `Highlighted quote: ${highlightedText || 'No marked text present; infer from the evidence block.'}`,
      `Evidence text: ${evidenceText}`,
      'Rank this debate card from 1 to 10 based on strategic usefulness, warrant quality, direct relevance to the target, source/citation credibility, and how cleanly the highlighted evidence proves the tag.',
      'A 10 is round-winning, highly specific, well-warranted, and directly usable. A 1 is barely relevant, generic, unsupported, or strategically weak.',
      'Return only compact JSON in this exact shape: {"score":8,"label":"Strong card","rationale":"One short sentence explaining the score."}',
    ].join('\n');

    const completion = await client.chat.completions.create({
      model,
      temperature: 0.15,
      max_tokens: 150,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'You are a debate evidence quality judge. Return only JSON. Be strict, calibrated, and evidence-faithful.',
        },
        {
          role: 'user',
          content: userPrompt,
        },
      ],
    });

    const rawRanking = completion.choices[0]?.message?.content?.trim();

    if (!rawRanking) {
      return NextResponse.json({ error: 'The model returned an empty card ranking.' }, { status: 502 });
    }

    const rating = normalizeRatingPayload(extractJsonObject(rawRanking));
    if (!rating) {
      return NextResponse.json({ error: 'The model returned an invalid card ranking.' }, { status: 502 });
    }

    return NextResponse.json({ rating, modelUsed: model });
  } catch (error) {
    console.error('Card ranking generation error:', error);

    const status =
      error && typeof error === 'object' && 'status' in error && typeof error.status === 'number'
        ? error.status
        : 500;
    const code =
      error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
        ? error.code
        : undefined;
    const message =
      error instanceof Error ? error.message : 'Card ranking generation failed unexpectedly.';

    return NextResponse.json({ error: message, code }, { status });
  }
}
