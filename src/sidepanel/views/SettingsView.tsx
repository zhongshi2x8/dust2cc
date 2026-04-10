import React, { useEffect, useMemo, useState } from 'react';
import { validateLLMConfig } from '@shared/llm-config';
import { PROVIDERS, getProviderOption } from '@shared/provider-options';
import type { AnalysisStyle, AnalysisPeriodMode, KlinePeriod, LLMConfig, UserSettings } from '@shared/types';

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
    allowNoApiKey: false,
    maxTokens: 2000,
    temperature: 0.3,
  };
}

function buildInitialCompareDraft(settings: UserSettings | null): LLMConfig {
  return settings?.comparison.llm ?? {
    provider: 'deepseek',
    apiKey: '',
    model: 'deepseek-chat',
    allowNoApiKey: false,
    maxTokens: 2000,
    temperature: 0.3,
  };
}

export function SettingsView() {
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [draft, setDraft] = useState<LLMConfig>(buildInitialDraft(null));
  const [compareDraft, setCompareDraft] = useState<LLMConfig>(buildInitialCompareDraft(null));
  const [providerPickerOpen, setProviderPickerOpen] = useState(false);
  const [comparePickerOpen, setComparePickerOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [notice, setNotice] = useState('');
  const [testResult, setTestResult] = useState('');
  const periodOptions: KlinePeriod[] = ['1h', '4h', '1d', '1w'];

  useEffect(() => {
    let cancelled = false;

    async function loadSettings() {
      setLoading(true);
      const response = await sendMessage<UserSettings>({ type: 'GET_SETTINGS' });
      if (cancelled) return;

      if (response.ok && response.data) {
        setSettings(response.data);
        setDraft(buildInitialDraft(response.data));
        setCompareDraft(buildInitialCompareDraft(response.data));
        setProviderPickerOpen(response.data.llm.provider === 'openai_compatible_custom');
        setComparePickerOpen(response.data.comparison.enabled);
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
  const selectedCompareProvider = useMemo(
    () => getProviderOption(compareDraft.provider),
    [compareDraft.provider],
  );
  const customProviderSelected = draft.provider === 'openai_compatible_custom';
  const customCompareProviderSelected = compareDraft.provider === 'openai_compatible_custom';

  function updateDraft(next: Partial<LLMConfig>) {
    setDraft((current) => ({ ...current, ...next }));
    setNotice('');
    setTestResult('');
  }

  function updateCompareDraft(next: Partial<LLMConfig>) {
    setCompareDraft((current) => ({ ...current, ...next }));
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
      allowNoApiKey: provider === 'openai_compatible_custom' ? draft.allowNoApiKey : false,
      ...(provider === 'ollama' && !draft.baseUrl ? { baseUrl: 'http://localhost:11434/v1' } : {}),
    });
    setProviderPickerOpen(provider === 'openai_compatible_custom');
  }

  function handleCompareProviderChange(provider: LLMConfig['provider']) {
    const providerOption = getProviderOption(provider);
    const previousOption = getProviderOption(compareDraft.provider);
    const nextModel =
      !compareDraft.model
      || compareDraft.model === previousOption?.models[0]
      || (previousOption?.models.length ? previousOption.models.includes(compareDraft.model) : false)
        ? (providerOption?.models[0] ?? compareDraft.model)
        : compareDraft.model;

    updateCompareDraft({
      provider,
      model: nextModel,
      allowNoApiKey: provider === 'openai_compatible_custom' ? compareDraft.allowNoApiKey : false,
      ...(provider === 'ollama' && !compareDraft.baseUrl ? { baseUrl: 'http://localhost:11434/v1' } : {}),
    });
  }

  function validateDraftBeforeSubmit(): string | null {
    return validateLLMConfig({
      ...draft,
      apiKey: draft.apiKey.trim(),
      baseUrl: draft.baseUrl?.trim() || undefined,
      model: draft.model.trim(),
    });
  }

  function validateCompareDraftBeforeSubmit(): string | null {
    if (!settings?.comparison.enabled) return null;
    return validateLLMConfig({
      ...compareDraft,
      apiKey: compareDraft.apiKey.trim(),
      baseUrl: compareDraft.baseUrl?.trim() || undefined,
      model: compareDraft.model.trim(),
    });
  }

  async function handleSave() {
    const validationError = validateDraftBeforeSubmit();
    if (validationError) {
      setNotice(validationError);
      return;
    }
    const compareValidationError = validateCompareDraftBeforeSubmit();
    if (compareValidationError) {
      setNotice(`对比模型配置有误：${compareValidationError}`);
      return;
    }

    setSaving(true);
    setNotice('');

    const response = await sendMessage<void>({
      type: 'SAVE_SETTINGS',
      data: {
        llm: draft,
        comparison: settings?.comparison ? {
          enabled: settings.comparison.enabled,
          llm: compareDraft,
        } : undefined,
        analysis: settings?.analysis,
      },
    });

    setSaving(false);

    if (!response.ok) {
      setNotice(response.error || '保存失败');
      return;
    }

    setSettings((current) => (current ? {
      ...current,
      llm: draft,
      comparison: settings?.comparison ? {
        ...settings.comparison,
        llm: compareDraft,
      } : current.comparison,
      analysis: settings?.analysis ?? current.analysis,
    } : current));
    setNotice('设置已保存');
  }

  async function handleTestConnection() {
    const validationError = validateDraftBeforeSubmit();
    if (validationError) {
      setTestResult(validationError);
      return;
    }

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

      <div className="provider-details">
        <div className="form-group">
          <label htmlFor="period-mode-select">分析周期模式</label>
          <select
            id="period-mode-select"
            value={settings?.analysis.periodMode ?? 'single'}
            onChange={(event) => {
              const periodMode = event.target.value as UserSettings['analysis']['periodMode'];
              setSettings((current) => current ? {
                ...current,
                analysis: {
                  ...current.analysis,
                  periodMode,
                },
              } : current);
            }}
          >
            <option value="single">{getPeriodModeLabel('single')}</option>
            <option value="multi">{getPeriodModeLabel('multi')}</option>
          </select>
        </div>

        <div className="form-group">
          <label htmlFor="default-period-select">默认分析周期</label>
          <select
            id="default-period-select"
            value={settings?.analysis.defaultPeriod ?? '1d'}
            onChange={(event) => {
              const defaultPeriod = event.target.value as KlinePeriod;
              setSettings((current) => current ? {
                ...current,
                analysis: {
                  ...current.analysis,
                  defaultPeriod,
                },
              } : current);
            }}
          >
            {periodOptions.map((period) => (
              <option key={period} value={period}>
                {period}
              </option>
            ))}
          </select>
        </div>

        <div className="form-group">
          <label htmlFor="analysis-style-select">分析风格</label>
          <select
            id="analysis-style-select"
            value={settings?.analysis.aiStyle ?? 'balanced'}
            onChange={(event) => {
              const aiStyle = event.target.value as UserSettings['analysis']['aiStyle'];
              setSettings((current) => current ? {
                ...current,
                analysis: {
                  ...current.analysis,
                  aiStyle,
                },
              } : current);
            }}
          >
            <option value="balanced">{getAnalysisStyleLabel('balanced')}</option>
            <option value="conservative">{getAnalysisStyleLabel('conservative')}</option>
            <option value="aggressive">{getAnalysisStyleLabel('aggressive')}</option>
            <option value="objective">{getAnalysisStyleLabel('objective')}</option>
          </select>
        </div>
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

      <details
        className="provider-details"
        open={comparePickerOpen}
        onToggle={(event) => setComparePickerOpen((event.currentTarget as HTMLDetailsElement).open)}
      >
        <summary>对比模型配置</summary>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={settings?.comparison.enabled === true}
            onChange={(event) => {
              setSettings((current) => current ? {
                ...current,
                comparison: {
                  ...current.comparison,
                  enabled: event.target.checked,
                },
              } : current);
            }}
          />
          <span>启用对比模型分析</span>
        </label>

        {settings?.comparison.enabled && (
          <div className="comparison-form">
            <div className="form-group">
              <label htmlFor="compare-provider-select">对比 Provider</label>
              <select
                id="compare-provider-select"
                value={compareDraft.provider}
                onChange={(event) => handleCompareProviderChange(event.target.value as LLMConfig['provider'])}
              >
                {PROVIDERS.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label htmlFor="compare-model-input">对比 Model</label>
              <input
                id="compare-model-input"
                type="text"
                value={compareDraft.model}
                onChange={(event) => updateCompareDraft({ model: event.target.value })}
                placeholder={selectedCompareProvider?.models[0] ?? '例如：gpt-4o-mini'}
              />
            </div>

            <div className="form-group">
              <label htmlFor="compare-api-key-input">对比 API Key</label>
              <input
                id="compare-api-key-input"
                type="password"
                value={compareDraft.apiKey}
                onChange={(event) => updateCompareDraft({ apiKey: event.target.value })}
                placeholder={selectedCompareProvider?.placeholder ?? 'sk-...'}
              />
            </div>

            {customCompareProviderSelected && (
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={compareDraft.allowNoApiKey === true}
                  onChange={(event) => updateCompareDraft({ allowNoApiKey: event.target.checked })}
                />
                <span>这个对比接口不需要 API Key</span>
              </label>
            )}

            <div className="form-group">
              <label htmlFor="compare-base-url-input">对比 Base URL</label>
              <input
                id="compare-base-url-input"
                type="text"
                value={compareDraft.baseUrl ?? ''}
                onChange={(event) => updateCompareDraft({ baseUrl: event.target.value })}
                placeholder={customCompareProviderSelected ? '例如：https://your-proxy.example.com/v1' : '通常不需要填写'}
              />
            </div>
          </div>
        )}
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
        <label htmlFor="model-input">Model{customProviderSelected ? '（必填）' : ''}</label>
        <input
          id="model-input"
          list="provider-models"
          type="text"
          value={draft.model}
          onChange={(event) => updateDraft({ model: event.target.value })}
          placeholder={selectedProvider?.models[0] ?? '例如：gpt-4o-mini'}
        />
        {customProviderSelected && (
          <span className="field-help">自定义接口下这是必填项，请填写网关实际支持的模型名。</span>
        )}
        <datalist id="provider-models">
          {(selectedProvider?.models || []).map((model) => (
            <option key={model} value={model} />
          ))}
        </datalist>
      </div>

      <div className="form-group">
        <label htmlFor="api-key-input">
          API Key{customProviderSelected && !draft.allowNoApiKey ? '（必填）' : ''}
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

      {customProviderSelected && (
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={draft.allowNoApiKey === true}
            onChange={(event) => updateDraft({ allowNoApiKey: event.target.checked })}
          />
          <span>这个自定义接口不需要 API Key</span>
        </label>
      )}

      <div className="form-group">
        <label htmlFor="base-url-input">Base URL{customProviderSelected ? '（必填）' : ''}</label>
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
        <span className="field-help">
          {customProviderSelected
            ? '必须填写你的 OpenAI-compatible 网关地址，程序会自动拼接 /chat/completions。'
            : '预设供应商通常不需要填写，只有走代理或自定义网关时才需要。'}
        </span>
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

function getPeriodModeLabel(mode: AnalysisPeriodMode): string {
  return mode === 'multi' ? '多周期联动分析' : '单周期分析';
}

function getAnalysisStyleLabel(style: AnalysisStyle): string {
  switch (style) {
    case 'conservative':
      return '保守风格';
    case 'aggressive':
      return '激进风格';
    case 'objective':
      return '客观风格';
    default:
      return '平衡风格';
  }
}
