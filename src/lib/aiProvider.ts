import OpenAI from 'openai';

export const GROK_BASE_URL = 'https://api.x.ai/v1';
export const OPENAI_BASE_URL = 'https://api.openai.com/v1';
export const GROQ_BASE_URL = 'https://api.groq.com/openai/v1';
export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
export const DEEPSEEK_BASE_URL = 'https://api.deepseek.com/v1';
export const OMNIROUTERS_BASE_URL = 'https://omnirouters.com/v1';
export const OLLAMA_BASE_URL = 'http://localhost:11434/v1';
export const LM_STUDIO_BASE_URL = 'http://localhost:1234/v1';

export const DEFAULT_GROQ_API_KEY = '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';
export const DEFAULT_CLOUD_MODEL = 'openai/gpt-oss-120b';
export const DEFAULT_GROK_MODEL = 'grok-2-latest';
export const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';
export const DEFAULT_GROQ_MODEL = 'openai/gpt-oss-120b';
export const DEFAULT_LOCAL_MODEL = 'llama3.2';

export type AiProviderMode = 'cloud' | 'local' | 'auto';
export type AiProviderType = 'auto' | 'grok' | 'openai' | 'groq' | 'openrouter' | 'deepseek' | 'custom' | 'local';
export type LocalModelRole = 'planner' | 'navigator';

export interface AiConfigOptions {
  providerMode?: AiProviderMode;
  providerType?: AiProviderType;
  apiKey?: string;
  apiKeys?: string[];
  groqApiKeys?: string[];
  baseUrl?: string;
  model?: string;
  localBaseUrl?: string;
  localModel?: string;
  localApiKey?: string;
  signal?: AbortSignal;
  fallbackOnRateLimit?: boolean;
  density?: 'tech' | 'lay';
}

export function detectProviderFromKey(key: string): AiProviderType {
  const trimmed = (key || '').trim();
  if (trimmed.startsWith('xai-')) return 'grok';
  if (trimmed.startsWith('sk-or-')) return 'openrouter';
  if (trimmed.startsWith('gsk_') || trimmed.startsWith('gsk-')) return 'groq';
  if (trimmed.startsWith('sk-')) return 'openai';
  return 'auto';
}

export function parseApiKeys(value: string): string[] {
  return Array.from(new Set(value.split(/[\n,]+/).map((key) => key.trim()).filter(Boolean)));
}

export function readStoredText(key: string): string {
  if (typeof window === 'undefined') return '';
  const value = window.localStorage.getItem(key);
  if (value === null) return '';
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === 'string' ? parsed : value;
  } catch {
    return value;
  }
}

export function getCompatibleBaseUrl(apiKey: string, explicitUrl?: string, providerType?: AiProviderType): string {
  if (explicitUrl && explicitUrl.trim()) return explicitUrl.trim();
  const trimmedKey = (apiKey || '').trim();

  if (providerType === 'grok') return GROK_BASE_URL;
  if (providerType === 'openai') return OPENAI_BASE_URL;
  if (providerType === 'groq') return GROQ_BASE_URL;
  if (providerType === 'openrouter') return OPENROUTER_BASE_URL;
  if (providerType === 'deepseek') return DEEPSEEK_BASE_URL;
  if (providerType === 'local') return OLLAMA_BASE_URL;

  // Auto-detection based on API key prefix
  if (trimmedKey.startsWith('http://') || trimmedKey.startsWith('https://')) return trimmedKey;
  if (trimmedKey.startsWith('xai-')) return GROK_BASE_URL;
  if (trimmedKey.startsWith('sk-or-')) return OPENROUTER_BASE_URL;
  if (trimmedKey.startsWith('gsk_') || trimmedKey.startsWith('gsk-')) return GROQ_BASE_URL;
  if (trimmedKey.startsWith('sk-')) return OPENAI_BASE_URL;

  return GROQ_BASE_URL;
}

export function getCompatibleModel(apiKey: string, explicitModel?: string, providerType?: AiProviderType): string {
  const trimmedKey = (apiKey || '').trim();
  const configuredModel = explicitModel?.trim();
  const isGroq = providerType === 'groq' || trimmedKey.startsWith('gsk_') || trimmedKey.startsWith('gsk-');

  if (configuredModel) {
    if (isGroq && configuredModel === 'llama-3.3-70b-versatile') return DEFAULT_GROQ_MODEL;
    return configuredModel;
  }

  if (providerType === 'grok' || trimmedKey.startsWith('xai-')) return DEFAULT_GROK_MODEL;
  if (providerType === 'openai' || (trimmedKey.startsWith('sk-') && !trimmedKey.startsWith('sk-or-'))) return DEFAULT_OPENAI_MODEL;
  if (isGroq) return DEFAULT_GROQ_MODEL;
  if (providerType === 'openrouter' || trimmedKey.startsWith('sk-or-')) return 'openai/gpt-4o-mini';
  if (providerType === 'deepseek') return 'deepseek-chat';
  if (providerType === 'local') return DEFAULT_LOCAL_MODEL;

  return DEFAULT_CLOUD_MODEL;
}

export function createAiClient(options?: AiConfigOptions): { client: OpenAI; model: string; isLocal: boolean } {
  const providerMode = options?.providerMode || 'cloud';
  const localBaseUrl = options?.localBaseUrl?.trim() || OLLAMA_BASE_URL;
  const localModel = options?.localModel?.trim() || DEFAULT_LOCAL_MODEL;
  const localApiKey = options?.localApiKey?.trim() || 'ollama-local-key';

  if (providerMode === 'local') {
    return {
      client: new OpenAI({
        apiKey: localApiKey,
        baseURL: localBaseUrl,
      }),
      model: localModel,
      isLocal: true,
    };
  }

  const apiKey =
    options?.apiKey?.trim() ||
    process.env.GROK_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.OMNIROUTERS_API_KEY ||
    process.env.GROQ_API_KEY ||
    DEFAULT_GROQ_API_KEY;

  const baseURL = getCompatibleBaseUrl(apiKey, options?.baseUrl, options?.providerType);
  const model = getCompatibleModel(apiKey, options?.model, options?.providerType);

  return {
    client: new OpenAI({ apiKey, baseURL }),
    model,
    isLocal: false,
  };
}

export async function runChatCompletionWithFallback(
  options: AiConfigOptions,
  params: Omit<OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming, 'model'>
): Promise<{ completion: OpenAI.Chat.Completions.ChatCompletion; usedLocal: boolean; modelUsed: string }> {
  const { providerMode = 'cloud', localBaseUrl = OLLAMA_BASE_URL, localModel = DEFAULT_LOCAL_MODEL } = options;
  const localApiKey = options.localApiKey?.trim() || 'ollama-local-key';

  // Direct local mode
  if (providerMode === 'local') {
    const localAi = new OpenAI({ apiKey: localApiKey, baseURL: localBaseUrl });
    const completion = await localAi.chat.completions.create({
      ...params,
      model: localModel,
    }, options.signal ? { signal: options.signal } : undefined);
    return { completion, usedLocal: true, modelUsed: localModel };
  }

  // Cloud mode with Grok / OpenAI / Groq / custom compatibility
  const apiKey =
    options.apiKey?.trim() ||
    process.env.GROK_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.OMNIROUTERS_API_KEY ||
    process.env.GROQ_API_KEY ||
    DEFAULT_GROQ_API_KEY;

  const baseURL = getCompatibleBaseUrl(apiKey, options.baseUrl, options.providerType);
  const model = getCompatibleModel(apiKey, options.model, options.providerType);
  const cloudAi = new OpenAI({ apiKey, baseURL });

  try {
    const completion = await cloudAi.chat.completions.create({
      ...params,
      model,
    }, options.signal ? { signal: options.signal } : undefined);
    return { completion, usedLocal: false, modelUsed: model };
  } catch (error: unknown) {
    const status = error instanceof Error && 'status' in error && typeof error.status === 'number' ? error.status : undefined;
    const isRateLimit = status === 429 || status === 413;

    // Fall back to local open-weight model if rate-limited or in 'auto' mode
    if ((isRateLimit && options.fallbackOnRateLimit !== false) || (providerMode === 'auto' && !isRateLimit)) {
      console.warn('Cloud AI rate-limited or unavailable. Falling back to local open-weight model...', localBaseUrl, localModel);
      try {
        const localAi = new OpenAI({ apiKey: localApiKey, baseURL: localBaseUrl });
        const completion = await localAi.chat.completions.create({
          ...params,
          model: localModel,
        }, options.signal ? { signal: options.signal } : undefined);
        return { completion, usedLocal: true, modelUsed: localModel };
      } catch (localError) {
        console.error('Local open-weight fallback also failed:', localError);
        throw error;
      }
    }

    throw error;
  }
}

export function getAiConfigFromStorage(
  localModelRole: LocalModelRole = 'planner',
  advanceApiKey = true
): AiConfigOptions {
  if (typeof window === 'undefined') {
    return {
      providerMode: 'auto',
      providerType: 'auto',
      apiKey: '',
      baseUrl: '',
      model: '',
      density: 'tech',
    };
  }

  const savedProviderType = (readStoredText('debate_ai_provider_type') || 'auto') as AiProviderType;
  const providerType = savedProviderType === 'local' ? 'auto' : savedProviderType;
  const providerMode = (readStoredText('debate_ai_provider_mode') || 'auto') as AiProviderMode;

  const storedKeyList = window.localStorage.getItem('debate_ai_api_keys');
  let sharedApiKeys: string[] = [];
  if (storedKeyList) {
    try {
      const parsed: unknown = JSON.parse(storedKeyList);
      if (typeof parsed === 'string') sharedApiKeys = parseApiKeys(parsed);
      else if (Array.isArray(parsed)) {
        sharedApiKeys = parseApiKeys(parsed.filter((key): key is string => typeof key === 'string').join('\n'));
      }
    } catch {
      sharedApiKeys = parseApiKeys(storedKeyList);
    }
  }
  const legacyApiKeys = parseApiKeys([
    readStoredText('debate_ai_api_key'),
    readStoredText('debate_form_groq_api_keys'),
    readStoredText('groq_api_keys'),
    readStoredText('groq_api_key'),
  ].join('\n'));
  const apiKeys = storedKeyList !== null ? sharedApiKeys : legacyApiKeys;
  const keySignature = apiKeys.join('\n');
  const previousSignature = window.localStorage.getItem('debate_ai_api_key_cursor_signature');
  if (previousSignature !== keySignature) {
    window.localStorage.setItem('debate_ai_api_key_cursor_signature', keySignature);
    window.localStorage.setItem('debate_ai_api_key_cursor', '0');
  }
  const storedCursor = Number.parseInt(window.localStorage.getItem('debate_ai_api_key_cursor') || '0', 10);
  const cursor = Number.isFinite(storedCursor) ? Math.max(0, storedCursor) : 0;
  const apiKey = apiKeys[cursor] || '';
  const keysExhausted = apiKeys.length > 0 && cursor >= apiKeys.length;
  if (keysExhausted) {
    window.localStorage.setItem('debate_ai_api_key_cursor', '0');
  }
  if (apiKeys.length > 0 && advanceApiKey && !keysExhausted) {
    window.localStorage.setItem('debate_ai_api_key_cursor', String(cursor + 1));
  }
  const baseUrl = readStoredText('debate_ai_base_url').trim();
  const model = readStoredText('debate_ai_model').trim();
  const density = (readStoredText('debate_card_density') || 'tech') as 'tech' | 'lay';
  const localBaseUrl = readStoredText('debate_local_ai_url').trim();
  const localModel = readStoredText(
    localModelRole === 'planner'
      ? 'debate_local_ai_planner_model'
      : 'debate_local_ai_navigator_model'
  ).trim() || readStoredText('debate_local_ai_model').trim();
  const localApiKey = readStoredText('debate_local_ai_key').trim();

  return {
    providerMode: keysExhausted ? 'local' : providerMode,
    providerType,
    apiKey: keysExhausted ? '' : apiKey,
    apiKeys,
    groqApiKeys: keysExhausted || !apiKey ? [] : [apiKey],
    baseUrl,
    model,
    density,
    localBaseUrl: localBaseUrl || undefined,
    localModel: localModel || undefined,
    localApiKey: localApiKey || undefined,
  };
}
