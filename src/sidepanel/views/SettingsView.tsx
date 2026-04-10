import React, { useEffect, useMemo, useState } from 'react';
import { PROVIDERS, getProviderOption } from '@shared/provider-options';
import type { LLMConfig, UserSettings } from '@shared/types';

interface RuntimeResponse<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

function sendMessage<T>(message: { type: string; data?: unknown }): Promise<RuntimeResponse<T>> {
  return chrome.runtime.sendMessage(message);
}

function buildInitialDraft(settings: UserSettings | null): LLMConfig {
  return settings?.llm ?? {
    provider: 'deepseek',
    apiKey: '',
    model: 'deepseek-chat',
    maxTokens: 2000,
    temperature: 0.3,
  };
}

export function SettingsView() {
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [draft, setDraft] = useState<LLMConfig>(buildInitialDraft(null));
  const [providerPickerOpen, setProviderPickerOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [notice, setNotice] = useState('');
  const [testResult, setTestResult] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function loadSettings() {
      setLoading(true);
      const response = await sendMessage<UserSettings>({ type: 'GET_SETTINGS' });
      if (cancelled) return;

      if (response.ok && response.data) {
        setSettings(response.data);
        setDraft(buildInitialDraft(response.data));
        setProviderPickerOpen(response.data.llm.provider === 'openai_compatible_custom');
        setNotice('');
      } else {
        setNotice(response.error || '读取设置失败');
      }

      setLoading(false);
    }

    loadSettings();
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedProvider = useMemo(
    () => getProviderOption(draft.provider),
    [draft.provider],
  );

  function updateDraft(next: Partial<LLMConfig>) {
    setDraft((current) => ({ ...current, ...next }));
    setNotice('');
    setTestResult('');
  }

  function handleProviderChange(provider: LLMConfig['provider']) {
    const providerOption = getProviderOption(provider);
    const previousOption = getProviderOption(draft.provider);
    const nextModel =
      !draft.model
      || draft.model === previousOption?.models[0]
      || (previousOption?.models.length ? previousOption.models.includes(draft.model) : false)
        ? (providerOption?.models[0] ?? draft.model)
        : draft.model;

    updateDraft({
      provider,
      model: nextModel,
      ...(provider === 'ollama' && !draft.baseUrl ? { baseUrl: 'http://localhost:11434/v1' } : {}),
    });
    setProviderPickerOpen(provider === 'openai_compatible_custom');
  }

  async function handleSave() {
    setSaving(true);
    setNotice('');

    const response = await sendMessage<void>({
      type: 'SAVE_SETTINGS',
      data: {
        llm: draft,
      },
    });

    setSaving(false);

    if (!response.ok) {
      setNotice(response.error || '保存失败');
      return;
    }

    setSettings((current) => (current ? { ...current, llm: draft } : current));
    setNotice('设置已保存');
  }

  async function handleTestConnection() {
    setTesting(true);
    setTestResult('');

    const response = await sendMessage<{ ok: boolean; error?: string }>({
      type: 'TEST_LLM_CONNECTION',
      data: draft,
    });

    setTesting(false);

    if (!response.ok || !response.data) {
      setTestResult(response.error || '测试失败');
      return;
    }

    setTestResult(response.data.ok ? '连接成功，可以正常调用模型。' : (response.data.error || '连接失败'));
  }

  if (loading) {
    return <div className="settings-view"><div className="info-note">正在读取设置...</div></div>;
  }

  return (
    <div className="settings-view">
      <div className="setup-card">
        <h2>模型设置</h2>
        <p>支持预设模型，也支持任何兼容 OpenAI `/chat/completions` 的自定义接口。</p>
      </div>

      {selectedProvider && (
        <div className="selection-summary">
          <strong>当前选择：{selectedProvider.name}</strong>
          <span>{selectedProvider.summary}</span>
        </div>
      )}

      <details
        className="provider-details"
        open={providerPickerOpen}
        onToggle={(event) => setProviderPickerOpen((event.currentTarget as HTMLDetailsElement).open)}
      >
        <summary>模型选择</summary>
        <div className="provider-grid compact">
          {PROVIDERS.map((provider) => (
            <button
              key={provider.id}
              className={`provider-card ${draft.provider === provider.id ? 'active' : ''}`}
              onClick={() => handleProviderChange(provider.id)}
              type="button"
            >
              <div className="provider-card-head">
                <strong>{provider.name}</strong>
                <span className={`provider-badge ${provider.recommended ? '' : 'subtle'}`}>
                  {provider.recommended ? '推荐' : provider.setupLevel === 'easy' ? '简单' : '进阶'}
                </span>
              </div>
              <p>{provider.summary}</p>
            </button>
          ))}
        </div>
      </details>

      <div className="form-group">
        <label htmlFor="provider-select">Provider</label>
        <select
          id="provider-select"
          value={draft.provider}
          onChange={(event) => handleProviderChange(event.target.value as LLMConfig['provider'])}
        >
          {PROVIDERS.map((provider) => (
            <option key={provider.id} value={provider.id}>
              {provider.name}
            </option>
          ))}
        </select>
      </div>

      <div className="form-group">
        <label htmlFor="model-input">Model</label>
        <input
          id="model-input"
          list="provider-models"
          type="text"
          value={draft.model}
          onChange={(event) => updateDraft({ model: event.target.value })}
          placeholder={selectedProvider?.models[0] ?? '例如：gpt-4o-mini'}
        />
        <datalist id="provider-models">
          {(selectedProvider?.models || []).map((model) => (
            <option key={model} value={model} />
          ))}
        </datalist>
      </div>

      <div className="form-group">
        <label htmlFor="api-key-input">
          API Key
          {selectedProvider?.helpUrl && (
            <a href={selectedProvider.helpUrl} target="_blank" rel="noreferrer">
              获取 Key
            </a>
          )}
        </label>
        <input
          id="api-key-input"
          type="password"
          value={draft.apiKey}
          onChange={(event) => updateDraft({ apiKey: event.target.value })}
          placeholder={selectedProvider?.placeholder ?? 'sk-...'}
        />
      </div>

      <div className="form-group">
        <label htmlFor="base-url-input">Base URL</label>
        <input
          id="base-url-input"
          type="text"
          value={draft.baseUrl ?? ''}
          onChange={(event) => updateDraft({ baseUrl: event.target.value })}
          placeholder={
            draft.provider === 'openai_compatible_custom'
              ? '例如：https://your-proxy.example.com/v1'
              : '预设供应商通常不需要填写，可留空'
          }
        />
      </div>

      <div className="form-group">
        <label htmlFor="temperature-input">Temperature</label>
        <input
          id="temperature-input"
          type="number"
          min="0"
          max="2"
          step="0.1"
          value={draft.temperature}
          onChange={(event) => updateDraft({ temperature: Number(event.target.value) })}
        />
      </div>

      <div className="form-group">
        <label htmlFor="max-tokens-input">Max Tokens</label>
        <input
          id="max-tokens-input"
          type="number"
          min="1"
          step="1"
          value={draft.maxTokens}
          onChange={(event) => updateDraft({ maxTokens: Number(event.target.value) })}
        />
      </div>

      <details className="provider-details">
        <summary>模型建议</summary>
        <div className="selection-summary">
          <strong>推荐模型</strong>
          <span>{(selectedProvider?.models || []).join(' / ') || '你可以填写任何该平台支持的模型名。'}</span>
        </div>
      </details>

      <div className="form-actions">
        <button type="button" onClick={handleSave} disabled={saving}>
          {saving ? '保存中...' : '保存设置'}
        </button>
        <button type="button" onClick={handleTestConnection} disabled={testing}>
          {testing ? '测试中...' : '测试连接'}
        </button>
      </div>

      {notice && <div className="info-note">{notice}</div>}
      {testResult && (
        <div className={`test-result ${testResult.includes('成功') ? 'success-text' : 'error-text'}`}>
          {testResult}
        </div>
      )}

      {settings?.llm.provider === draft.provider && settings.llm.model === draft.model && (
        <div className="selection-summary">
          <strong>已生效配置</strong>
          <span>
            {settings.llm.provider} / {settings.llm.model}
          </span>
        </div>
      )}
    </div>
  );
}
