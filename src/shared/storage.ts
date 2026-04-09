// ============================================================
// Chrome Storage wrapper — settings & analysis cache
// ============================================================

import type { UserSettings, CachedAnalysis, LLMConfig } from './types';

const DEFAULT_SETTINGS: UserSettings = {
  llm: {
    provider: 'deepseek',
    apiKey: '',
    model: 'deepseek-chat',
    maxTokens: 2000,
    temperature: 0.3,
  },
  analysis: {
    autoAnalyze: false,
    defaultPeriod: '1d',
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

function normalizeSettings(rawSettings: Partial<UserSettings> | undefined): UserSettings {
  const merged: UserSettings = {
    ...DEFAULT_SETTINGS,
    ...rawSettings,
    llm: {
      ...DEFAULT_SETTINGS.llm,
      ...(rawSettings?.llm || {}),
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

  if ((merged.llm.provider as string) === 'custom') {
    merged.llm.provider = DEFAULT_SETTINGS.llm.provider;
    merged.llm.model = DEFAULT_SETTINGS.llm.model;
    merged.llm.baseUrl = undefined;
  }

  return merged;
}

/** Get user settings, merged with defaults */
export async function getSettings(): Promise<UserSettings> {
  const result = await chrome.storage.local.get('settings');
  return normalizeSettings(result.settings);
}

/** Save user settings */
export async function saveSettings(settings: Partial<UserSettings>): Promise<void> {
  const current = await getSettings();
  await chrome.storage.local.set({ settings: normalizeSettings({ ...current, ...settings }) });
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
