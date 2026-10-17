import { NextResponse } from 'next/server';
import { createAiClient, AiProviderMode, AiProviderType } from '../../../lib/aiProvider';

interface TaglineRequestBody {
  topic?: string;
  contention?: string;
  targetText?: string;
  targetMode?: 'Attack' | 'Support' | 'Defend';
  targetSide?: 'Affirmative' | 'Negative' | 'Support';
  type?: 'AFF' | 'NEG' | 'NQ' | 'NL' | 'DL' | 'T';
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

export async function POST(req: Request) {
  try {
    const {
      topic,
      contention,
      targetText,
      targetMode,
      targetSide,
      type,
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
    }: TaglineRequestBody = await req.json();

    if (!bodyHtml || !citation) {
      return NextResponse.json(
        { error: 'Missing required fields for tag line generation.' },
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
      `Citation: ${citation.trim()}`,
      `Reasoning notes: ${reasoning?.trim() || 'None provided'}`,
      `Highlighted quote: ${highlightedText || 'No marked text present; infer from the evidence block.'}`,
      `Evidence text: ${evidenceText}`,
      'Write one debate tag line that is faithful to the evidence.',
      'If this is an attack card, a good tag can be non-unique, no solvency, alt cause, alt solves, or a turn.',
      'Keep it punchy and specific. Do not invent claims the evidence does not support.',
      'Do not include the type prefix in your answer. The server will add it.',
      'Return only the tag line text with no quotation marks, numbering, or explanation.',
    ].join('\n');

    const completion = await client.chat.completions.create({
      model,
      temperature: 0.3,
      max_tokens: 80,
      messages: [
        {
          role: 'system',
          content:
            'You write concise debate card tag lines. Be accurate, strategic, and evidence-faithful. Never output analysis or labels.',
        },
        {
          role: 'user',
          content: userPrompt,
        },
      ],
    });

    const tag = completion.choices[0]?.message?.content?.trim();

    if (!tag) {
      return NextResponse.json({ error: 'The model returned an empty tag line.' }, { status: 502 });
    }

    const cleanedTagBody = tag
      .replace(/^["']|["']$/g, '')
      .replace(/^[A-Z]{1,3}\)\s*/, '')
      .trim();
    const prefixedTag = type ? `${type}) ${cleanedTagBody}` : cleanedTagBody;

    return NextResponse.json({ tag: appendPublishedYearToTag(prefixedTag, citation), modelUsed: model });
  } catch (error) {
    console.error('Tag line generation error:', error);

    const status =
      error && typeof error === 'object' && 'status' in error && typeof error.status === 'number'
        ? error.status
        : 500;
    const code =
      error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
        ? error.code
        : undefined;
    const message =
      error instanceof Error ? error.message : 'Tag line generation failed unexpectedly.';

    return NextResponse.json({ error: message, code }, { status });
  }
}
