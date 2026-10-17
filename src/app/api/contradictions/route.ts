import { NextResponse } from 'next/server';
import { createAiClient, AiProviderMode, AiProviderType } from '../../../lib/aiProvider';
import { normalizeEvidenceText } from '../../../lib/evidence';

interface ContradictionRequest {
  opponentText?: string;
  topic?: string;
  providerMode?: AiProviderMode;
  providerType?: AiProviderType;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  localBaseUrl?: string;
  localModel?: string;
  localApiKey?: string;
}

function getTextField(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

export async function POST(req: Request) {
  try {
    const {
      opponentText,
      topic = '',
      providerMode,
      providerType,
      apiKey,
      baseUrl,
      model: requestedModel,
      localBaseUrl,
      localModel,
      localApiKey,
    }: ContradictionRequest = await req.json();

    if (!opponentText || !opponentText.trim()) {
      return NextResponse.json({ error: 'Opponent text is required to find contradictions.' }, { status: 400 });
    }

    const trimmedText = opponentText.trim();
    if (trimmedText.length < 120) {
      return NextResponse.json({ error: 'Please provide at least a short paragraph so the tool can compare claims fairly.' }, { status: 400 });
    }

    const { client, model } = createAiClient({
      providerMode,
      providerType,
      apiKey,
      baseUrl,
      model: requestedModel,
      localBaseUrl,
      localModel,
      localApiKey,
    });

    const systemPrompt = `You are a world-class debate strategist and cross-examination expert.
Your job is to thoroughly analyze your opponent's evidence, speech text, or article and spot:
1. Direct internal contradictions (e.g. claiming X increases in paragraph 1, but claiming X decreases in paragraph 3).
2. Logical flaws & non-sequiturs (flawed causal links or leap of logic).
3. Data/statistics misalignments or date discrepancies.
4. Overclaims (claiming global catastrophe from a tiny regional effect).
5. Unintended concessions / Double turns (statements that actually help your side).

Only report flaws that are materially useful in a debate round. Every quote must be copied exactly from the supplied text; never invent, paraphrase, or complete a quote from memory. If the text does not support a claim of contradiction, omit it.

For each contradiction or flaw found, provide:
- flawType: Category (Internal Contradiction, Flawed Link, Overclaim, Concession, Data Discrepancy)
- quote1: Exact quote from opponent text for first claim
- quote2: Exact quote from opponent text for contradicting claim (or empty string if single-quote flaw)
- explanation: Detailed breakdown of why this is a flaw
- cxQuestion: A trap cross-examination question to ask the opponent in round
- speechRefutation: 2-3 sentence rebuttal speech block to read against this flaw.

OUTPUT FORMAT:
Respond ONLY with JSON:
{
  "summary": "Overall strategic summary of opponent's evidence weaknesses",
  "flaws": [
    {
      "flawType": "...",
      "quote1": "...",
      "quote2": "...",
      "explanation": "...",
      "cxQuestion": "...",
      "speechRefutation": "..."
    }
  ]
}`;

    const userPrompt = `Debate Topic: ${topic || 'General Debate'}

OPPONENT ARTICLE / SPEECH TEXT:
${trimmedText.slice(0, 16000)}`;

    const completion = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.2,
      max_tokens: 3000,
    });

    const parsed = JSON.parse(completion.choices[0]?.message?.content || '{}') as Record<string, unknown>;
    const normalizedSource = normalizeEvidenceText(trimmedText);
    const flaws = Array.isArray(parsed.flaws)
      ? parsed.flaws
          .filter((flaw): flaw is Record<string, unknown> => Boolean(flaw && typeof flaw === 'object'))
          .map((flaw) => {
            const rawQuote1 = getTextField(flaw.quote1, 600);
            const rawQuote2 = getTextField(flaw.quote2, 600);
            const normalizedQuote1 = normalizeEvidenceText(rawQuote1);
            const normalizedQuote2 = normalizeEvidenceText(rawQuote2);
            const quote1Valid = !normalizedQuote1 || normalizedSource.toLowerCase().includes(normalizedQuote1.toLowerCase());
            const quote2Valid = !normalizedQuote2 || normalizedSource.toLowerCase().includes(normalizedQuote2.toLowerCase());

            return {
              flawType: getTextField(flaw.flawType, 80) || 'Internal Contradiction',
              quote1: quote1Valid ? rawQuote1 : '',
              quote2: quote2Valid ? rawQuote2 : '',
              explanation: getTextField(flaw.explanation, 1200),
              cxQuestion: getTextField(flaw.cxQuestion, 500),
              speechRefutation: getTextField(flaw.speechRefutation, 800),
            };
          })
          .filter((flaw) => flaw.explanation && (!flaw.quote1 || flaw.quote1.length >= 10))
      : [];

    return NextResponse.json({
      summary: getTextField(parsed.summary, 1000) || 'Opponent case analysis complete.',
      flaws,
    });
  } catch (error: unknown) {
    console.error('Contradiction analysis error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error during contradiction analysis.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
