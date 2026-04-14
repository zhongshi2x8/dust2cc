// ============================================================
// Shared Constants
// ============================================================

export const EXTENSION_NAME = 'dust2.cc';
export const VERSION = '1.1.3';

/** Custom event name for page script → content script communication */
export const DATA_CAPTURE_EVENT = 'cs2-ai-data-captured';

/** Chrome storage keys */
export const STORAGE_KEYS = {
  SETTINGS: 'settings',
  ANALYSIS_CACHE: 'analysisCache',
  CHAT_HISTORY: 'chatHistory',
} as const;

/** Supported sites */
export const SUPPORTED_SITES = [
  { name: 'csqaq', label: 'CSQAQ', urlPattern: /csqaq\.com/ },
  { name: 'steamdt', label: 'SteamDT', urlPattern: /steamdt\.com/ },
  { name: 'buff', label: 'BUFF', urlPattern: /buff\.163\.com/ },
  { name: 'youpin', label: '悠悠有品', urlPattern: /youpin898\.com/ },
] as const;

// ----- Display Label Helpers -----

import type { AnalysisPeriodMode, AnalysisStyle, TradeSignal } from './types';

export function getPeriodModeLabel(mode: AnalysisPeriodMode): string {
  return mode === 'multi' ? '多周期联动分析' : '单周期分析';
}

export function getPeriodModeShortLabel(mode: AnalysisPeriodMode): string {
  return mode === 'multi' ? '多周期' : '单周期';
}

export function getAnalysisStyleLabel(style: AnalysisStyle): string {
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

export function getSignalLabel(action: TradeSignal['action']): string {
  switch (action) {
    case 'buy':
      return '买入';
    case 'sell':
      return '卖出';
    default:
      return '观望';
  }
}
