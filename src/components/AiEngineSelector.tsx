'use client';

import React, { useEffect, useRef, useState } from 'react';
import { usePersistentState } from '../lib/usePersistentState';
import { DEFAULT_GROQ_MODEL, detectProviderFromKey, parseApiKeys, readStoredText } from '../lib/aiProvider';

export type AiProviderMode = 'cloud' | 'local' | 'auto';
export type AiProviderType = 'auto' | 'grok' | 'openai' | 'groq' | 'openrouter' | 'deepseek' | 'custom' | 'local';

export function AiEngineSelector() {
  const [providerMode, setProviderMode] = usePersistentState<AiProviderMode>('debate_ai_provider_mode', 'auto');
  const [providerType, setProviderType] = usePersistentState<AiProviderType>('debate_ai_provider_type', 'auto');
  const [apiKeysText, setApiKeysText] = usePersistentState('debate_ai_api_keys', '');
  const [baseUrl, setBaseUrl] = usePersistentState('debate_ai_base_url', '');
  const [model, setModel] = usePersistentState('debate_ai_model', '');
  const [density, setDensity] = usePersistentState<'tech' | 'lay'>('debate_card_density', 'tech');

  const [localUrl, setLocalUrl] = usePersistentState('debate_local_ai_url', 'http://localhost:11434/v1');
  const [localPlannerModel, setLocalPlannerModel] = usePersistentState('debate_local_ai_planner_model', 'llama3.2');
  const [localNavigatorModel, setLocalNavigatorModel] = usePersistentState('debate_local_ai_navigator_model', 'llama3.2');
  const [localApiKey, setLocalApiKey] = usePersistentState('debate_local_ai_key', '');

  const [expanded, setExpanded] = useState(false);
  const apiKeyNumbersRef = useRef<HTMLDivElement | null>(null);
  const [testing, setTesting] = useState(false);
  const [testingTarget, setTestingTarget] = useState<'cloud' | 'local' | null>(null);
  const [testResult, setTestResult] = useState<{
    target: 'cloud' | 'local';
    success: boolean;
    message: string;
  } | null>(null);

  useEffect(() => {
    const legacyModel = readStoredText('debate_local_ai_model');
    if (!legacyModel) return;
    if (window.localStorage.getItem('debate_local_ai_planner_model') === null) {
      setLocalPlannerModel(legacyModel);
    }
    if (window.localStorage.getItem('debate_local_ai_navigator_model') === null) {
      setLocalNavigatorModel(legacyModel);
    }
  }, [setLocalNavigatorModel, setLocalPlannerModel]);

  useEffect(() => {
    const isGroq = providerType === 'groq' || detectProviderFromKey(parseApiKeys(apiKeysText)[0] || '') === 'groq';
    if (isGroq && model === 'llama-3.3-70b-versatile') setModel(DEFAULT_GROQ_MODEL);
  }, [apiKeysText, model, providerType, setModel]);

  useEffect(() => {
    if (window.localStorage.getItem('debate_ai_api_keys') !== null) return;
    const legacyKeys = [
      readStoredText('debate_ai_api_key'),
      readStoredText('debate_form_groq_api_keys'),
      readStoredText('groq_api_keys'),
      readStoredText('groq_api_key'),
    ].filter(Boolean);
    if (legacyKeys.length > 0) setApiKeysText(parseApiKeys(legacyKeys.join('\n')).join('\n'));
  }, [setApiKeysText]);

  const handleKeyChange = (val: string) => {
    setApiKeysText(val);
    const firstKey = parseApiKeys(val)[0] || '';
    if (providerType === 'auto' && firstKey) {
      const detected = detectProviderFromKey(firstKey);
      if (detected !== 'auto') {
        setProviderType(detected);
        if (detected === 'grok') {
          setBaseUrl('https://api.x.ai/v1');
          setModel('grok-2-latest');
        } else if (detected === 'openai') {
          setBaseUrl('https://api.openai.com/v1');
          setModel('gpt-4o-mini');
        } else if (detected === 'groq') {
          setBaseUrl('https://api.groq.com/openai/v1');
          setModel(DEFAULT_GROQ_MODEL);
        } else if (detected === 'openrouter') {
          setBaseUrl('https://openrouter.ai/api/v1');
          setModel('openai/gpt-4o-mini');
        }
      }
    }
  };

  const handleProviderSelect = (type: AiProviderType) => {
    setProviderType(type);
    setTestResult(null);
    if (type === 'grok') {
      setBaseUrl('https://api.x.ai/v1');
      if (!model || model.includes('llama') || model.includes('gpt')) setModel('grok-2-latest');
    } else if (type === 'openai') {
      setBaseUrl('https://api.openai.com/v1');
      if (!model || model.includes('grok') || model.includes('llama')) setModel('gpt-4o-mini');
    } else if (type === 'groq') {
      setBaseUrl('https://api.groq.com/openai/v1');
      if (!model || model === 'llama-3.3-70b-versatile' || model.includes('grok')) setModel(DEFAULT_GROQ_MODEL);
    } else if (type === 'openrouter') {
      setBaseUrl('https://openrouter.ai/api/v1');
      if (!model) setModel('openai/gpt-4o-mini');
    } else if (type === 'deepseek') {
      setBaseUrl('https://api.deepseek.com/v1');
      setModel('deepseek-chat');
    }
  };

  const testConnection = async (target: 'cloud' | 'local') => {
    setTesting(true);
    setTestingTarget(target);
    setTestResult(null);
    try {
      const targetUrl =
        target === 'local'
          ? localUrl.trim() || 'http://localhost:11434/v1'
          : baseUrl.trim() || 'https://api.openai.com/v1';
      const targetKey =
        target === 'local'
          ? localApiKey.trim() || 'ollama'
          : parseApiKeys(apiKeysText)[0] || '';

      const cleanBase = targetUrl.replace(/\/+$/, '');
      const testEndpoint = `${cleanBase}/models`;

      const res = await fetch(testEndpoint, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...(targetKey ? { Authorization: `Bearer ${targetKey}` } : {}),
        },
        signal: AbortSignal.timeout(6000),
      });

      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        const modelList = Array.isArray(data.data) ? data.data.map((m: { id: string }) => m.id).slice(0, 4).join(', ') : '';
        setTestResult({
          target,
          success: true,
          message: `Connected! ${modelList ? `Models: ${modelList}…` : 'Endpoint responding.'}`,
        });
      } else {
        setTestResult({
          target,
          success: false,
          message: `HTTP ${res.status} — check API key and URL.`,
        });
      }
    } catch (err) {
      setTestResult({
        target,
        success: false,
        message: err instanceof Error ? `Error: ${err.message}` : 'Failed to connect.',
      });
    } finally {
      setTesting(false);
      setTestingTarget(null);
    }
  };

  const providerLabel = (() => {
    if (providerMode === 'local') return 'Local (Ollama / LM Studio)';
    const cloudProviderLabel = (() => {
      if (providerType === 'grok') return 'xAI Grok';
      if (providerType === 'openai') return 'OpenAI';
      if (providerType === 'groq') return 'Groq Cloud';
      if (providerType === 'openrouter') return 'OpenRouter';
      if (providerType === 'deepseek') return 'DeepSeek';
      if (providerType === 'custom') return 'Custom Endpoint';
      return 'Auto / Cloud';
    })();
    return providerMode === 'auto' ? `${cloudProviderLabel} with local fallback` : cloudProviderLabel;
  })();

  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontFamily: 'var(--font-mono)',
    fontSize: '0.72rem',
    fontWeight: 600,
    color: 'var(--foreground)',
    marginBottom: '0.4rem',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
  };

  const pillStyle = (active: boolean): React.CSSProperties => ({
    padding: '0.35rem 0.7rem',
    fontSize: '0.72rem',
    fontFamily: 'var(--font-mono)',
    fontWeight: active ? 600 : 400,
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    borderRadius: 'var(--radius)',
    border: active ? '1px solid var(--primary)' : '1px solid var(--border)',
    background: active ? 'var(--primary)' : 'var(--card)',
    color: active ? 'var(--primary-foreground)' : 'var(--muted-foreground)',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.3rem',
    transition: 'all 0.15s ease',
  });

  return (
    <div
      className="ai-engine-selector"
      style={{
        padding: '0.85rem 1.1rem',
        borderRadius: 'var(--radius)',
        background: 'var(--card)',
        border: '1px solid var(--border)',
        marginBottom: '1.25rem',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            <strong style={{ fontSize: '0.88rem', color: 'var(--foreground)' }}>
              AI Engine: {providerLabel}
            </strong>
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '0.68rem',
                padding: '0.15rem 0.5rem',
                borderRadius: 'var(--radius)',
                background: 'var(--secondary)',
                border: '1px solid var(--border)',
                color: 'var(--foreground)',
                fontWeight: 500,
              }}
            >
              {model || (providerMode === 'local' ? `Planner: ${localPlannerModel}` : 'Auto-detected')}
            </span>
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '0.68rem',
                padding: '0.15rem 0.5rem',
                borderRadius: 'var(--radius)',
                background: 'var(--secondary)',
                border: '1px solid var(--border)',
                color: 'var(--foreground)',
                fontWeight: 500,
              }}
            >
              {density === 'tech' ? 'Tech' : 'Lay'} Density
            </span>
          </div>
          <p style={{ margin: '3px 0 0', fontSize: '0.78rem', color: 'var(--muted-foreground)' }}>
            Works with <strong>Grok</strong>, <strong>OpenAI</strong>, <strong>Groq</strong>, <strong>OpenRouter</strong>, <strong>DeepSeek</strong>, or any OpenAI-compatible key.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
          {/* Density Switch */}
          <div style={{ display: 'inline-flex', borderRadius: 'var(--radius)', border: '1px solid var(--border)', padding: '2px', background: 'var(--secondary)' }}>
            <button
              type="button"
              onClick={() => setDensity('tech')}
              style={{
                padding: '0.3rem 0.6rem',
                fontSize: '0.72rem',
                fontFamily: 'var(--font-mono)',
                fontWeight: 600,
                borderRadius: 'calc(var(--radius) - 2px)',
                border: 'none',
                cursor: 'pointer',
                background: density === 'tech' ? 'var(--primary)' : 'transparent',
                color: density === 'tech' ? 'var(--primary-foreground)' : 'var(--muted-foreground)',
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
              }}
              title="Dense circuit debate warrants & evidence"
            >
              Tech
            </button>
            <button
              type="button"
              onClick={() => setDensity('lay')}
              style={{
                padding: '0.3rem 0.6rem',
                fontSize: '0.72rem',
                fontFamily: 'var(--font-mono)',
                fontWeight: 600,
                borderRadius: 'calc(var(--radius) - 2px)',
                border: 'none',
                cursor: 'pointer',
                background: density === 'lay' ? 'var(--primary)' : 'transparent',
                color: density === 'lay' ? 'var(--primary-foreground)' : 'var(--muted-foreground)',
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
              }}
              title="Accessible warrants for parent judges"
            >
              Lay
            </button>
          </div>

          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="btn-secondary"
            style={{ padding: '0.35rem 0.8rem', fontSize: '0.72rem' }}
          >
            {expanded ? '▲ Hide' : 'Configure'}
          </button>
        </div>
      </div>

      {expanded && (
        <div
          style={{
            marginTop: '1rem',
            paddingTop: '1rem',
            borderTop: '1px solid var(--border)',
            display: 'grid',
            gap: '1rem',
          }}
        >
          {/* Provider Selection */}
          <div>
            <label style={labelStyle}>Use AI Engine</label>
            <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', marginBottom: '0.85rem' }}>
              {([
                { id: 'cloud', label: 'Cloud' },
                { id: 'local', label: 'Local' },
                { id: 'auto', label: 'Auto fallback' },
              ] as const).map((mode) => (
                <button
                  key={mode.id}
                  type="button"
                  onClick={() => {
                    setProviderMode(mode.id);
                    setTestResult(null);
                  }}
                  style={pillStyle(providerMode === mode.id)}
                  aria-pressed={providerMode === mode.id}
                >
                  {mode.label}
                </button>
              ))}
            </div>
            <label style={labelStyle}>Cloud Provider</label>
            <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
              {[
                { id: 'auto', label: 'Auto' },
                { id: 'grok', label: 'Grok' },
                { id: 'openai', label: 'OpenAI' },
                { id: 'groq', label: 'Groq' },
                { id: 'openrouter', label: 'OpenRouter' },
                { id: 'deepseek', label: 'DeepSeek' },
                { id: 'custom', label: 'Custom' },
              ].map((p) => {
                const isSelected = providerType === p.id || (p.id === 'auto' && providerType === 'local');
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => handleProviderSelect(p.id as AiProviderType)}
                    style={pillStyle(isSelected)}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Cloud Settings */}
          <section aria-label="Cloud AI configuration">
            <p style={{ ...labelStyle, marginBottom: '0.65rem' }}>Cloud AI configuration</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.85rem' }}>
              <div>
                <label style={labelStyle}>Cloud API keys</label>
                <div style={{ display: 'flex', alignItems: 'stretch' }}>
                  <div
                    ref={apiKeyNumbersRef}
                    aria-hidden="true"
                    style={{
                      minWidth: '2.5rem',
                      padding: '0.8rem 0.55rem',
                      overflow: 'hidden',
                      border: '1px solid var(--card-border)',
                      borderRight: 'none',
                      borderRadius: '8px 0 0 8px',
                      background: 'var(--secondary)',
                      color: 'var(--muted-foreground)',
                      textAlign: 'right',
                      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                      fontSize: '0.86rem',
                      lineHeight: 1.4,
                      userSelect: 'none',
                    }}
                  >
                    {Array.from({ length: Math.max(4, apiKeysText.split('\n').length) }, (_, index) => (
                      <div key={index}>{index + 1}.</div>
                    ))}
                  </div>
                  <textarea
                    placeholder={
                      providerType === 'grok' ? 'xai-...' :
                      providerType === 'openai' ? 'sk-...' :
                      providerType === 'groq' ? 'gsk_...' :
                      providerType === 'openrouter' ? 'sk-or-...' :
                      'Enter one API key per line…'
                    }
                    value={apiKeysText}
                    onChange={(e) => handleKeyChange(e.target.value)}
                    onScroll={(e) => {
                      if (apiKeyNumbersRef.current) {
                        apiKeyNumbersRef.current.scrollTop = e.currentTarget.scrollTop;
                      }
                    }}
                    rows={4}
                    aria-label="Cloud API keys, one per line"
                    style={{
                      width: '100%',
                      padding: '0.8rem',
                      background: 'var(--input-bg)',
                      border: '1px solid var(--card-border)',
                      color: 'var(--foreground)',
                      borderRadius: '0 8px 8px 0',
                      resize: 'vertical',
                      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                      fontSize: '0.86rem',
                      lineHeight: 1.4,
                    }}
                  />
                </div>
                <small style={{ display: 'block', marginTop: '0.35rem', color: 'var(--muted-foreground)' }}>
                  Enter one key on each numbered line. Prepper rotates through the keys as requests are made.
                </small>
              </div>

              <div>
                <label style={labelStyle}>Base URL</label>
                <input
                  type="text"
                  placeholder="https://api.openai.com/v1"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  style={{ fontSize: '0.86rem' }}
                />
              </div>

              <div>
                <label style={labelStyle}>Model</label>
                <input
                  type="text"
                  placeholder={
                    providerType === 'grok' ? 'grok-2-latest' :
                    providerType === 'openai' ? 'gpt-4o-mini' :
                    providerType === 'groq' ? DEFAULT_GROQ_MODEL :
                    'Model identifier…'
                  }
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  style={{ fontSize: '0.86rem' }}
                />
              </div>
            </div>
          </section>

          {/* Local Settings */}
          <section aria-label="Local AI configuration">
            <p style={{ ...labelStyle, marginBottom: '0.65rem' }}>Local AI configuration</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.85rem' }}>
              <div>
                <label style={labelStyle}>Local URL</label>
                <input
                  type="text"
                  value={localUrl}
                  onChange={(e) => setLocalUrl(e.target.value)}
                  placeholder="http://localhost:11434/v1"
                  style={{ fontSize: '0.86rem' }}
                />
              </div>
              <div>
                <label style={labelStyle}>Planner Model</label>
                <input
                  type="text"
                  value={localPlannerModel}
                  onChange={(e) => setLocalPlannerModel(e.target.value)}
                  placeholder="e.g. llama3.2"
                  style={{ fontSize: '0.86rem' }}
                />
                <small style={{ display: 'block', marginTop: '0.35rem', color: 'var(--muted-foreground)' }}>
                  Used for argument planning and card generation.
                </small>
              </div>
              <div>
                <label style={labelStyle}>Navigator Model</label>
                <input
                  type="text"
                  value={localNavigatorModel}
                  onChange={(e) => setLocalNavigatorModel(e.target.value)}
                  placeholder="e.g. qwen2.5"
                  style={{ fontSize: '0.86rem' }}
                />
                <small style={{ display: 'block', marginTop: '0.35rem', color: 'var(--muted-foreground)' }}>
                  Used for evidence searches, source navigation, and article cutting.
                </small>
              </div>
              <div>
                <label style={labelStyle}>Local API Key (optional)</label>
                <input
                  type="text"
                  value={localApiKey}
                  onChange={(e) => setLocalApiKey(e.target.value)}
                  placeholder="ollama or blank"
                  style={{ fontSize: '0.86rem' }}
                />
              </div>
            </div>
          </section>

          {/* Test Connection */}
          <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
            <button
              type="button"
              onClick={() => testConnection('cloud')}
              disabled={testing}
              className="btn-secondary"
              style={{ fontSize: '0.72rem', padding: '0.4rem 0.9rem' }}
            >
              {testing && testingTarget === 'cloud' ? 'Testing cloud…' : 'Test cloud'}
            </button>
            <button
              type="button"
              onClick={() => testConnection('local')}
              disabled={testing}
              className="btn-secondary"
              style={{ fontSize: '0.72rem', padding: '0.4rem 0.9rem' }}
            >
              {testing && testingTarget === 'local' ? 'Testing local…' : 'Test local'}
            </button>

            {testResult && (
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.76rem',
                  color: testResult.success ? '#16a34a' : '#b91c1c',
                  fontWeight: 600,
                }}
              >
                {testResult.target === 'cloud' ? 'Cloud: ' : 'Local: '}
                {testResult.success ? '✓ ' : '✕ '} {testResult.message}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
