// ============================================================
// Prompt: Quick Trade Signal — shorter, focused on action
// ============================================================

import type { IndicatorResult, PatternMatch, TradeSignal } from '../types';

function isFinitePositive(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function resolveSignalAnchorPrice(
  currentPrice: number,
  indicators: IndicatorResult,
): number {
  const references = [
    indicators.boll.mid,
    indicators.ma.ma20,
    indicators.ma.ma10,
    indicators.ma.ma5,
  ].filter(isFinitePositive);

  if (!isFinitePositive(currentPrice) || !references.length) {
    return currentPrice;
  }

  const closestReference = references.reduce((best, value) => {
    if (!isFinitePositive(best)) return value;
    return Math.abs(value - currentPrice) < Math.abs(best - currentPrice) ? value : best;
  }, Number.NaN);

  if (!isFinitePositive(closestReference)) {
    return currentPrice;
  }

  const deltaRatio = Math.abs(currentPrice - closestReference) / closestReference;
  return deltaRatio >= 0.6 ? closestReference : currentPrice;
}

/**
 * Generate a quick trade signal locally (no LLM needed).
 * This runs instantly and provides a signal badge while
 * the full LLM analysis streams in.
 */
export function generateQuickSignal(
  currentPrice: number,
  indicators: IndicatorResult,
  patterns: PatternMatch[],
): TradeSignal {
  const anchorPrice = resolveSignalAnchorPrice(currentPrice, indicators);
  let score = 0; // -5 to +5 scale
  const reasons: string[] = [];
  const ma20 = indicators.ma.ma20;
  const bollLower = indicators.boll.lower;
  const bollUpper = indicators.boll.upper;
  const macdHistogram = indicators.macd.histogram;
  const rsi = indicators.rsi;
  const volumeRatio = indicators.volume.ratio;
  const kValue = indicators.kdj.k;
  const dValue = indicators.kdj.d;
  const jValue = indicators.kdj.j;

  // MA trend
  if (isFinitePositive(ma20)) {
    if (anchorPrice > ma20) {
      score += 1;
      reasons.push('价格在MA20上方');
    } else {
      score -= 1;
      reasons.push('价格在MA20下方');
    }
  }

  // MACD
  if (indicators.macd.signal === 'golden_cross') {
    score += 1.5;
    reasons.push('MACD金叉');
  } else if (indicators.macd.signal === 'death_cross') {
    score -= 1.5;
    reasons.push('MACD死叉');
  }
  if (Number.isFinite(macdHistogram)) {
    if (macdHistogram > 0) score += 0.5;
    else score -= 0.5;
  }

  // RSI
  if (Number.isFinite(rsi) && rsi < 30) {
    score += 1.5;
    reasons.push('RSI超卖');
  } else if (Number.isFinite(rsi) && rsi > 70) {
    score -= 1.5;
    reasons.push('RSI超买');
  }

  // Bollinger position
  if (isFinitePositive(bollLower) && anchorPrice <= bollLower) {
    score += 1;
    reasons.push('触及布林下轨');
  } else if (isFinitePositive(bollUpper) && anchorPrice >= bollUpper) {
    score -= 1;
    reasons.push('触及布林上轨');
  }

  // KDJ
  if (Number.isFinite(jValue) && Number.isFinite(kValue) && Number.isFinite(dValue) && jValue > kValue && kValue > dValue) {
    score += 0.5;
  } else if (Number.isFinite(jValue) && Number.isFinite(kValue) && Number.isFinite(dValue) && jValue < kValue && kValue < dValue) {
    score -= 0.5;
  }

  // Volume
  if (Number.isFinite(volumeRatio) && volumeRatio > 1.5) {
    // Volume expansion amplifies the signal direction
    score *= 1.2;
    reasons.push('放量');
  }

  // Pattern bonuses
  for (const p of patterns) {
    if (p.type === 'bullish') score += p.confidence;
    else if (p.type === 'bearish') score -= p.confidence;
    reasons.push(p.nameZh);
  }

  // Normalize to action
  const action: TradeSignal['action'] =
    score >= 2 ? 'buy' : score <= -2 ? 'sell' : 'hold';

  const confidence = Math.min(95, Math.max(10, Math.round(Math.abs(score) * 15 + 20)));

  // --- Compute key trading levels ---
  const support = isFinitePositive(bollLower) ? bollLower : anchorPrice * 0.94;
  const rawResistance = isFinitePositive(bollUpper) ? bollUpper : anchorPrice * 1.06;
  const resistance = rawResistance > support ? rawResistance : anchorPrice * 1.06;
  const priceRange = Math.max(anchorPrice * 0.04, resistance - support);

  // Buy zone: slightly above support (support + 5% of range)
  const buyZone = clamp(support + priceRange * 0.05, support, anchorPrice * 1.01);

  // Stop-loss: below support by ~3% of current price (practical stop)
  const stopLoss = clamp(
    Math.min(support - anchorPrice * 0.02, support * 0.985),
    anchorPrice * 0.82,
    anchorPrice * 0.995,
  );

  // Breakout chase: slightly above resistance (resistance + 2% buffer)
  const breakout = clamp(resistance + priceRange * 0.02, anchorPrice * 1.005, anchorPrice * 1.22);

  // Target price: based on signal direction
  const target =
    action === 'buy'
      ? clamp(anchorPrice + priceRange * 0.6, anchorPrice * 1.02, anchorPrice * 1.25)
      : action === 'sell'
        ? clamp(anchorPrice - priceRange * 0.4, anchorPrice * 0.82, anchorPrice * 0.99)
        : resistance;

  return {
    action,
    confidence,
    reason: (reasons.slice(0, 3).join('，') || '当前以价格区间和短线动量为主'),
    support,
    resistance,
    buyZone,
    stopLoss,
    breakout,
    target,
  };
}
