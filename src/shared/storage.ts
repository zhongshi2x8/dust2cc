// ============================================================
// Chrome Storage wrapper — settings & analysis cache
// ============================================================

import type { UserSettings, CachedAnalysis, LLMConfig, AnalysisHistoryEntry } from './types';

export interface SettingsPatch {
  llm?: Partial<LLMConfig>;
  comparison?: {
    enabled?: boolean;
    llm?: Partial<LLMConfig>;
  };
  analysis?: Partial<UserSettings['analysis']>;
  ui?: Partial<UserSettings['ui']>;
  advanced?: Partial<UserSettings['advanced']>;
}

const DEFAULT_SETTINGS: UserSettings = {
  llm: {
    provider: 'deepseek',
    apiKey: '',
    model: 'deepseek-chat',
    allowNoApiKey: false,
    maxTokens: 2000,
    temperature: 0.3,
  },
  comparison: {
    enabled: false,
    llm: {
      provider: 'deepseek',
      apiKey: '',
      model: 'deepseek-chat',
      allowNoApiKey: false,
      maxTokens: 2000,
      temperature: 0.3,
    },
  },
  analysis: {
    autoAnalyze: false,
    periodMode: 'single',
    defaultPeriod: '1d',
    aiStyle: 'balanced',
    enabledIndicators: ['MA', 'MACD', 'RSI', 'BOLL', 'KDJ'],
  },
  ui: {
    panelPosition: 'below-chart',
    theme: 'auto',
    language: 'zh',
    collapsed: false,
  },
  advanced: {
    cacheEnabled: true,
    cacheTTLMinutes: 30,
  },
};

const LEGACY_CUSTOM_PROVIDER = 'custom';

function clampTemperature(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return fallback;
  return Math.min(2, Math.max(0, value));
}

function normalizeMaxTokens(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return fallback;
  return Math.max(1, Math.round(value));
}

export function normalizeSettings(rawSettings: SettingsPatch | undefined): UserSettings {
  const merged: UserSettings = {
    ...DEFAULT_SETTINGS,
    ...rawSettings,
    llm: {
      ...DEFAULT_SETTINGS.llm,
      ...(rawSettings?.llm || {}),
    },
    comparison: {
      ...DEFAULT_SETTINGS.comparison,
      ...(rawSettings?.comparison || {}),
      llm: {
        ...DEFAULT_SETTINGS.comparison.llm,
        ...(rawSettings?.comparison?.llm || {}),
      },
    },
    analysis: {
      ...DEFAULT_SETTINGS.analysis,
      ...(rawSettings?.analysis || {}),
    },
    ui: {
      ...DEFAULT_SETTINGS.ui,
      ...(rawSettings?.ui || {}),
    },
    advanced: {
      ...DEFAULT_SETTINGS.advanced,
      ...(rawSettings?.advanced || {}),
    },
  };

  if ((merged.llm.provider as string) === LEGACY_CUSTOM_PROVIDER) {
    merged.llm.provider = 'openai_compatible_custom';
  }

  merged.llm.apiKey = merged.llm.apiKey.trim();
  const trimmedModel = merged.llm.model.trim();
  merged.llm.model =
    merged.llm.provider === 'openai_compatible_custom'
      ? trimmedModel
      : trimmedModel || DEFAULT_SETTINGS.llm.model;
  merged.llm.baseUrl = merged.llm.baseUrl?.trim() || undefined;
  merged.llm.allowNoApiKey = merged.llm.allowNoApiKey === true;
  merged.llm.temperature = clampTemperature(merged.llm.temperature, DEFAULT_SETTINGS.llm.temperature);
  merged.llm.maxTokens = normalizeMaxTokens(merged.llm.maxTokens, DEFAULT_SETTINGS.llm.maxTokens);
  merged.comparison.enabled = merged.comparison.enabled === true;
  merged.comparison.llm.apiKey = merged.comparison.llm.apiKey.trim();
  const trimmedCompareModel = merged.comparison.llm.model.trim();
  merged.comparison.llm.model =
    merged.comparison.llm.provider === 'openai_compatible_custom'
      ? trimmedCompareModel
      : trimmedCompareModel || DEFAULT_SETTINGS.comparison.llm.model;
  merged.comparison.llm.baseUrl = merged.comparison.llm.baseUrl?.trim() || undefined;
  merged.comparison.llm.allowNoApiKey = merged.comparison.llm.allowNoApiKey === true;
  merged.comparison.llm.temperature = clampTemperature(
    merged.comparison.llm.temperature,
    DEFAULT_SETTINGS.comparison.llm.temperature,
  );
  merged.comparison.llm.maxTokens = normalizeMaxTokens(
    merged.comparison.llm.maxTokens,
    DEFAULT_SETTINGS.comparison.llm.maxTokens,
  );

  return merged;
}

export function mergeSettings(
  current: UserSettings,
  next: SettingsPatch,
): UserSettings {
  return normalizeSettings({
    ...current,
    ...next,
    llm: {
      ...current.llm,
      ...(next.llm || {}),
    },
    comparison: {
      ...current.comparison,
      ...(next.comparison || {}),
      llm: {
        ...current.comparison.llm,
        ...(next.comparison?.llm || {}),
      },
    },
    analysis: {
      ...current.analysis,
      ...(next.analysis || {}),
    },
    ui: {
      ...current.ui,
      ...(next.ui || {}),
    },
    advanced: {
      ...current.advanced,
      ...(next.advanced || {}),
    },
  });
}

/** Get user settings, merged with defaults */
export async function getSettings(): Promise<UserSettings> {
  const result = await chrome.storage.local.get('settings');
  return normalizeSettings(result.settings);
}

/** Save user settings */
export async function saveSettings(settings: SettingsPatch): Promise<void> {
  const current = await getSettings();
  await chrome.storage.local.set({ settings: mergeSettings(current, settings) });
}

/** Get LLM config from settings */
export async function getLLMConfig(): Promise<LLMConfig> {
  const settings = await getSettings();
  return settings.llm;
}

/** Save an analysis result to cache */
export async function cacheAnalysis(entry: CachedAnalysis): Promise<void> {
  const result = await chrome.storage.local.get('analysisCache');
  const cache: Record<string, CachedAnalysis> = result.analysisCache || {};
  const key = `${entry.goodsId}_${entry.period}`;
  cache[key] = entry;
  await chrome.storage.local.set({ analysisCache: cache });
}

/** Get cached analysis if not expired */
export async function getCachedAnalysis(
  goodsId: string,
  period: string,
): Promise<CachedAnalysis | null> {
  const settings = await getSettings();
  if (!settings.advanced.cacheEnabled) return null;

  const result = await chrome.storage.local.get('analysisCache');
  const cache: Record<string, CachedAnalysis> = result.analysisCache || {};
  const key = `${goodsId}_${period}`;
  const entry = cache[key];

  if (!entry) return null;
  const ttl = settings.advanced.cacheTTLMinutes * 60 * 1000;
  if (Date.now() - entry.createdAt > ttl) return null;

  return entry;
}

/** Clear all cached analyses */
export async function clearCache(): Promise<void> {
  await chrome.storage.local.remove('analysisCache');
}

const ANALYSIS_HISTORY_KEY = 'analysisHistory';
const ANALYSIS_HISTORY_LIMIT = 50;

export async function getAnalysisHistory(): Promise<AnalysisHistoryEntry[]> {
  const result = await chrome.storage.local.get(ANALYSIS_HISTORY_KEY);
  return result[ANALYSIS_HISTORY_KEY] || [];
}

export async function saveAnalysisHistoryEntry(entry: AnalysisHistoryEntry): Promise<void> {
  const history = await getAnalysisHistory();
  const nextHistory = [entry, ...history].slice(0, ANALYSIS_HISTORY_LIMIT);
  await chrome.storage.local.set({ [ANALYSIS_HISTORY_KEY]: nextHistory });
}

export async function clearAnalysisHistory(): Promise<void> {
  await chrome.storage.local.remove(ANALYSIS_HISTORY_KEY);
}
