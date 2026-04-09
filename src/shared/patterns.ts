// ============================================================
// K-Line Pattern Detection — pure local algorithms
// ============================================================

import type { KlinePoint, PatternMatch } from './types';

/** Detect all recognizable patterns in K-line data */
export function detectAllPatterns(kline: KlinePoint[]): PatternMatch[] {
  if (kline.length < 10) return [];

  const results: PatternMatch[] = [];
  results.push(...detectDoubleBottom(kline));
  results.push(...detectDoubleTop(kline));
  results.push(...detectBullishEngulfing(kline));
  results.push(...detectBearishEngulfing(kline));
  results.push(...detectHammer(kline));
  results.push(...detectDoji(kline));
  results.push(...detectVolumePriceDivergence(kline));

  // TODO: implement more patterns
  // - Head and Shoulders (头肩顶/底)
  // - Triangle (三角形收敛)
  // - Morning/Evening Star (启明星/黄昏星)
  // - Rising/Falling Wedge (上升/下降楔形)

  return results
    .filter((p) => p.confidence >= 0.6)
    .sort((a, b) => b.confidence - a.confidence);
}

// ----- Helpers -----

function isLocalMin(arr: number[], idx: number, window: number): boolean {
  const start = Math.max(0, idx - window);
  const end = Math.min(arr.length - 1, idx + window);
  for (let i = start; i <= end; i++) {
    if (i !== idx && arr[i] < arr[idx]) return false;
  }
  return true;
}

function isLocalMax(arr: number[], idx: number, window: number): boolean {
  const start = Math.max(0, idx - window);
  const end = Math.min(arr.length - 1, idx + window);
  for (let i = start; i <= end; i++) {
    if (i !== idx && arr[i] > arr[idx]) return false;
  }
  return true;
}

// ----- Pattern Detectors -----

function detectDoubleBottom(kline: KlinePoint[]): PatternMatch[] {
  const lows = kline.map((k) => k.low);
  const matches: PatternMatch[] = [];
  const recent = lows.slice(-30);

  for (let i = 3; i < recent.length - 3; i++) {
    if (!isLocalMin(recent, i, 3)) continue;
    for (let j = i + 5; j < recent.length; j++) {
      if (!isLocalMin(recent, j, 3)) continue;
      const diff = Math.abs(recent[i] - recent[j]) / recent[i];
      if (diff < 0.03) {
        const midHigh = Math.max(...recent.slice(i, j + 1));
        const depth = (midHigh - recent[i]) / midHigh;
        if (depth > 0.04) {
          matches.push({
            name: 'Double Bottom',
            nameZh: '双底 (W底)',
            type: 'bullish',
            confidence: Math.min(0.9, 0.6 + depth * 2),
            description: `在近${30 - i}~${30 - j}日形成双底，支撑位 ¥${recent[i].toFixed(2)}`,
            startIdx: kline.length - 30 + i,
            endIdx: kline.length - 30 + j,
          });
        }
      }
    }
  }
  return matches;
}

function detectDoubleTop(kline: KlinePoint[]): PatternMatch[] {
  const highs = kline.map((k) => k.high);
  const matches: PatternMatch[] = [];
  const recent = highs.slice(-30);

  for (let i = 3; i < recent.length - 3; i++) {
    if (!isLocalMax(recent, i, 3)) continue;
    for (let j = i + 5; j < recent.length; j++) {
      if (!isLocalMax(recent, j, 3)) continue;
      const diff = Math.abs(recent[i] - recent[j]) / recent[i];
      if (diff < 0.03) {
        const midLow = Math.min(...recent.slice(i, j + 1));
        const depth = (recent[i] - midLow) / recent[i];
        if (depth > 0.04) {
          matches.push({
            name: 'Double Top',
            nameZh: '双顶 (M头)',
            type: 'bearish',
            confidence: Math.min(0.9, 0.6 + depth * 2),
            description: `在近${30 - i}~${30 - j}日形成双顶，阻力位 ¥${recent[i].toFixed(2)}`,
            startIdx: kline.length - 30 + i,
            endIdx: kline.length - 30 + j,
          });
        }
      }
    }
  }
  return matches;
}

function detectBullishEngulfing(kline: KlinePoint[]): PatternMatch[] {
  const matches: PatternMatch[] = [];
  const recent = kline.slice(-10);

  for (let i = 1; i < recent.length; i++) {
    const prev = recent[i - 1];
    const curr = recent[i];
    // Previous is bearish, current is bullish and engulfs previous body
    if (
      prev.close < prev.open &&
      curr.close > curr.open &&
      curr.open <= prev.close &&
      curr.close >= prev.open
    ) {
      const bodyRatio = (curr.close - curr.open) / (prev.open - prev.close);
      if (bodyRatio >= 1.2) {
        matches.push({
          name: 'Bullish Engulfing',
          nameZh: '看涨吞没',
          type: 'bullish',
          confidence: Math.min(0.85, 0.6 + bodyRatio * 0.1),
          description: `第${i}根K线形成看涨吞没形态`,
          startIdx: kline.length - 10 + i - 1,
          endIdx: kline.length - 10 + i,
        });
      }
    }
  }
  return matches;
}

function detectBearishEngulfing(kline: KlinePoint[]): PatternMatch[] {
  const matches: PatternMatch[] = [];
  const recent = kline.slice(-10);

  for (let i = 1; i < recent.length; i++) {
    const prev = recent[i - 1];
    const curr = recent[i];
    if (
      prev.close > prev.open &&
      curr.close < curr.open &&
      curr.open >= prev.close &&
      curr.close <= prev.open
    ) {
      const bodyRatio = (curr.open - curr.close) / (prev.close - prev.open);
      if (bodyRatio >= 1.2) {
        matches.push({
          name: 'Bearish Engulfing',
          nameZh: '看跌吞没',
          type: 'bearish',
          confidence: Math.min(0.85, 0.6 + bodyRatio * 0.1),
          description: `第${i}根K线形成看跌吞没形态`,
          startIdx: kline.length - 10 + i - 1,
          endIdx: kline.length - 10 + i,
        });
      }
    }
  }
  return matches;
}

function detectHammer(kline: KlinePoint[]): PatternMatch[] {
  const matches: PatternMatch[] = [];
  const recent = kline.slice(-5);

  for (let i = 0; i < recent.length; i++) {
    const k = recent[i];
    const body = Math.abs(k.close - k.open);
    const lowerShadow = Math.min(k.open, k.close) - k.low;
    const upperShadow = k.high - Math.max(k.open, k.close);

    // Hammer: small body, long lower shadow (>= 2x body), tiny upper shadow
    if (body > 0 && lowerShadow >= body * 2 && upperShadow <= body * 0.5) {
      matches.push({
        name: 'Hammer',
        nameZh: '锤子线',
        type: 'bullish',
        confidence: Math.min(0.8, 0.55 + (lowerShadow / body) * 0.05),
        description: '出现锤子线形态，下影线较长，可能预示底部反转',
        startIdx: kline.length - 5 + i,
        endIdx: kline.length - 5 + i,
      });
    }
  }
  return matches;
}

function detectDoji(kline: KlinePoint[]): PatternMatch[] {
  const matches: PatternMatch[] = [];
  const recent = kline.slice(-5);

  for (let i = 0; i < recent.length; i++) {
    const k = recent[i];
    const body = Math.abs(k.close - k.open);
    const totalRange = k.high - k.low;

    // Doji: very small body relative to total range
    if (totalRange > 0 && body / totalRange < 0.1) {
      matches.push({
        name: 'Doji',
        nameZh: '十字星',
        type: 'neutral',
        confidence: 0.65,
        description: '出现十字星，开盘价与收盘价几乎相同，市场犹豫不决',
        startIdx: kline.length - 5 + i,
        endIdx: kline.length - 5 + i,
      });
    }
  }
  return matches;
}

function detectVolumePriceDivergence(kline: KlinePoint[]): PatternMatch[] {
  if (kline.length < 10) return [];
  const matches: PatternMatch[] = [];

  const recent = kline.slice(-10);
  const prices = recent.map((k) => k.close);
  const volumes = recent.map((k) => k.volume);

  // Price rising but volume declining → bearish divergence
  const priceUp = prices[prices.length - 1] > prices[0];
  const avgVolFirst = volumes.slice(0, 5).reduce((a, b) => a + b, 0) / 5;
  const avgVolLast = volumes.slice(5).reduce((a, b) => a + b, 0) / 5;
  const volDown = avgVolLast < avgVolFirst * 0.7;

  if (priceUp && volDown) {
    matches.push({
      name: 'Bearish Volume Divergence',
      nameZh: '量价顶背离',
      type: 'bearish',
      confidence: 0.7,
      description: '价格上涨但成交量萎缩，可能预示上涨动能不足',
      startIdx: kline.length - 10,
      endIdx: kline.length - 1,
    });
  }

  // Price falling but volume declining → potential reversal
  const priceDown = prices[prices.length - 1] < prices[0];
  if (priceDown && volDown) {
    matches.push({
      name: 'Bullish Volume Divergence',
      nameZh: '量价底背离',
      type: 'bullish',
      confidence: 0.65,
      description: '价格下跌但抛压减少（缩量），下跌动能衰减',
      startIdx: kline.length - 10,
      endIdx: kline.length - 1,
    });
  }

  return matches;
}
