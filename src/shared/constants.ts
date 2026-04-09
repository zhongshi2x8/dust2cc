// ============================================================
// Shared Constants
// ============================================================

export const EXTENSION_NAME = 'dust2.cc';
export const VERSION = '1.0.0';

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
