// ============================================================
// CS2 AI Analyst — Shared Type Definitions
// ============================================================

// ----- K-Line / OHLCV -----

export interface KlinePoint {
  /** ISO date string or timestamp */
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type KlinePeriod = '1h' | '4h' | '1d' | '1w' | '1M';

// ----- Goods / Item Info -----

export interface GoodsInfo {
  id: string;
  name: string;
  /** Chinese name if available */
  zhName?: string;
  weapon?: string;
  rarity?: string;
  wear?: string;
  iconUrl?: string;
  /** Source platform identifier */
  source: SiteName;
}

export interface PriceInfo {
  current: number;
  currency: 'CNY' | 'USD';
  change24h?: number;
  changePercent24h?: number;
  /** Prices from multiple platforms */
  platforms?: PlatformPrice[];
}

export interface PlatformPrice {
  platform: string;
  price: number;
  currency: 'CNY' | 'USD';
  listingCount?: number;
  url?: string;
}

// ----- Listing / Market Depth -----

export interface Listing {
  price: number;
  wearValue?: number;
  paintSeed?: number;
  platform: string;
  updatedAt?: string;
}

// ----- Wear Distribution -----

export interface WearDistribution {
  range: string;       // e.g. "Factory New", "0.00-0.07"
  count: number;
  percentage: number;
}

// ----- Technical Indicators -----

export interface IndicatorResult {
  ma: { ma5: number; ma10: number; ma20: number; ma60: number };
  ema: { ema12: number; ema26: number };
  macd: { dif: number; dea: number; histogram: number; signal: 'golden_cross' | 'death_cross' | 'none' };
  rsi: number;
  boll: { upper: number; mid: number; lower: number; width: number };
  kdj: { k: number; d: number; j: number };
  volume: { avg5: number; avg20: number; ratio: number; trend: 'increasing' | 'decreasing' | 'stable' };
  overallSignal: 'bullish' | 'bearish' | 'neutral';
}

// ----- Pattern Recognition -----

export interface PatternMatch {
  name: string;
  nameZh: string;
  type: 'bullish' | 'bearish' | 'neutral';
  confidence: number;   // 0-1
  description: string;
  startIdx: number;
  endIdx: number;
}

// ----- AI Analysis -----

export interface AnalysisInput {
  goodsInfo: GoodsInfo;
  price: PriceInfo;
  kline: KlinePoint[];
  period: KlinePeriod;
  indicators: IndicatorResult;
  patterns: PatternMatch[];
}

export interface TradeSignal {
  action: 'buy' | 'sell' | 'hold';
  confidence: number;   // 0-100
  reason: string;
  support?: number;
  resistance?: number;
  /** Recommended buy zone — price level where buying is favorable */
  buyZone?: number;
  /** Stop-loss level — exit if price drops below this */
  stopLoss?: number;
  /** Breakout chase level — enter on breakout above this */
  breakout?: number;
  /** Target price — expected move target */
  target?: number;
}

export interface PageSnapshot {
  goodsInfo: GoodsInfo | null;
  price: PriceInfo | null;
  kline: KlinePoint[];
}

// ----- LLM Configuration -----

export type LLMProviderType =
  | 'claude'
  | 'openai'
  | 'deepseek'
  | 'qwen'
  | 'kimi'
  | 'kimi_code'
  | 'glm'
  | 'gemini'
  | 'ollama';

export interface LLMConfig {
  provider: LLMProviderType;
  apiKey: string;
  model: string;
  baseUrl?: string;
  maxTokens: number;
  temperature: number;
}

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

// ----- Extension Messaging -----

export type MessageType =
  | 'PAGE_DATA_CAPTURED'
  | 'PAGE_STATE_UPDATED'
  | 'KLINE_CAPTURED'
  | 'GOODS_CAPTURED'
  | 'REQUEST_ANALYSIS'
  | 'REQUEST_PAGE_STATE'
  | 'LLM_STREAM_START'
  | 'LLM_STREAM_CHUNK'
  | 'LLM_STREAM_END'
  | 'LLM_STREAM_ERROR'
  | 'GET_SETTINGS'
  | 'SAVE_SETTINGS'
  | 'TEST_CONNECTION';

export interface ExtensionMessage {
  type: MessageType;
  data?: unknown;
}

// ----- User Settings -----

export interface UserSettings {
  llm: LLMConfig;
  analysis: {
    autoAnalyze: boolean;
    defaultPeriod: KlinePeriod;
    enabledIndicators: string[];
  };
  ui: {
    panelPosition: 'below-chart' | 'right-sidebar';
    theme: 'auto' | 'light' | 'dark';
    language: 'zh' | 'en';
    collapsed: boolean;
  };
  advanced: {
    customSystemPrompt?: string;
    cacheEnabled: boolean;
    cacheTTLMinutes: number;
  };
}

// ----- Site Adapter -----

export type SiteName = 'csqaq' | 'buff' | 'youpin' | 'steamdt';

export interface SiteAdapter {
  name: SiteName;
  matchUrl: RegExp;
  canAnalyzeUrl?(url: string): boolean;
  extractGoodsInfo(): GoodsInfo | null;
  extractPrice(): PriceInfo | null;
  getPanelAnchor?(): HTMLElement | null;
  getChartAnchor(): HTMLElement | null;
  getApiPatterns(): ApiPattern[];
}

export interface ApiPattern {
  /** Regex to match against request URL */
  urlPattern: RegExp;
  /** What type of data this API returns */
  dataType: 'kline' | 'goods_detail' | 'listings' | 'wear_distribution';
  /** Function to normalize the response JSON into our standard format */
  normalize: (raw: unknown) => unknown;
}

// ----- Analysis Cache -----

export interface CachedAnalysis {
  goodsId: string;
  period: KlinePeriod;
  signal: TradeSignal;
  analysisText: string;
  indicators: IndicatorResult;
  patterns: PatternMatch[];
  createdAt: number;
}
