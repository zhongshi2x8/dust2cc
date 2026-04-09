// ============================================================
// Technical Indicators — pure local computation, no LLM needed
// ============================================================

import type { KlinePoint, IndicatorResult } from './types';

/** Simple Moving Average */
export function calcMA(data: number[], period: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      result.push(NaN);
      continue;
    }
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += data[j];
    result.push(sum / period);
  }
  return result;
}

/** Exponential Moving Average */
export function calcEMA(data: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const result: number[] = [data[0]];
  for (let i = 1; i < data.length; i++) {
    result.push(data[i] * k + result[i - 1] * (1 - k));
  }
  return result;
}

/** MACD (DIF, DEA, Histogram) */
export function calcMACD(
  closes: number[],
  fastPeriod = 12,
  slowPeriod = 26,
  signalPeriod = 9,
): { dif: number[]; dea: number[]; histogram: number[] } {
  const emaFast = calcEMA(closes, fastPeriod);
  const emaSlow = calcEMA(closes, slowPeriod);
  const dif = emaFast.map((v, i) => v - emaSlow[i]);
  const dea = calcEMA(dif, signalPeriod);
  const histogram = dif.map((v, i) => (v - dea[i]) * 2);
  return { dif, dea, histogram };
}

/** Relative Strength Index */
export function calcRSI(closes: number[], period = 14): number[] {
  const result: number[] = [];
  if (closes.length < period + 1) return result;

  let avgGain = 0;
  let avgLoss = 0;

  // First RSI value: simple average
  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) avgGain += change;
    else avgLoss += Math.abs(change);
  }
  avgGain /= period;
  avgLoss /= period;

  for (let i = 0; i < period; i++) result.push(NaN);
  result.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));

  // Subsequent values: Wilder's smoothing
  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + (change > 0 ? change : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (change < 0 ? Math.abs(change) : 0)) / period;
    result.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
  }

  return result;
}

/** Bollinger Bands */
export function calcBOLL(
  closes: number[],
  period = 20,
  multiplier = 2,
): { upper: number[]; mid: number[]; lower: number[] } {
  const mid = calcMA(closes, period);
  const upper: number[] = [];
  const lower: number[] = [];

  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) {
      upper.push(NaN);
      lower.push(NaN);
      continue;
    }
    const slice = closes.slice(i - period + 1, i + 1);
    const mean = mid[i];
    const variance = slice.reduce((sum, v) => sum + (v - mean) ** 2, 0) / period;
    const stdDev = Math.sqrt(variance);
    upper.push(mean + multiplier * stdDev);
    lower.push(mean - multiplier * stdDev);
  }

  return { upper, mid, lower };
}

/** KDJ Indicator */
export function calcKDJ(
  highs: number[],
  lows: number[],
  closes: number[],
  period = 9,
): { k: number[]; d: number[]; j: number[] } {
  const kValues: number[] = [];
  const dValues: number[] = [];
  const jValues: number[] = [];

  let prevK = 50;
  let prevD = 50;

  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) {
      kValues.push(NaN);
      dValues.push(NaN);
      jValues.push(NaN);
      continue;
    }
    const highSlice = highs.slice(i - period + 1, i + 1);
    const lowSlice = lows.slice(i - period + 1, i + 1);
    const hh = Math.max(...highSlice);
    const ll = Math.min(...lowSlice);
    const rsv = hh === ll ? 50 : ((closes[i] - ll) / (hh - ll)) * 100;

    const k = (2 / 3) * prevK + (1 / 3) * rsv;
    const d = (2 / 3) * prevD + (1 / 3) * k;
    const j = 3 * k - 2 * d;

    kValues.push(k);
    dValues.push(d);
    jValues.push(j);
    prevK = k;
    prevD = d;
  }

  return { k: kValues, d: dValues, j: jValues };
}

/** Helper: get last valid number from array */
function last(arr: number[]): number {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (Number.isFinite(arr[i])) return arr[i];
  }
  return Number.NaN;
}

/** Compute all indicators from K-line data → structured result for LLM prompt */
export function computeAllIndicators(kline: KlinePoint[]): IndicatorResult {
  const closes = kline.map((k) => k.close);
  const highs = kline.map((k) => k.high);
  const lows = kline.map((k) => k.low);
  const volumes = kline.map((k) => k.volume);

  const ma5 = calcMA(closes, 5);
  const ma10 = calcMA(closes, 10);
  const ma20 = calcMA(closes, 20);
  const ma60 = calcMA(closes, 60);

  const ema12 = calcEMA(closes, 12);
  const ema26 = calcEMA(closes, 26);

  const macd = calcMACD(closes);
  const rsi = calcRSI(closes);
  const boll = calcBOLL(closes);
  const kdj = calcKDJ(highs, lows, closes);

  const volAvg5 = last(calcMA(volumes, 5));
  const volAvg20 = last(calcMA(volumes, 20));
  const volRatio =
    Number.isFinite(volAvg5) && Number.isFinite(volAvg20) && volAvg20 > 0
      ? volAvg5 / volAvg20
      : Number.NaN;

  const lastDif = last(macd.dif);
  const lastDea = last(macd.dea);
  const prevDif = macd.dif.length >= 2 ? macd.dif[macd.dif.length - 2] : lastDif;
  const prevDea = macd.dea.length >= 2 ? macd.dea[macd.dea.length - 2] : lastDea;
  const macdSignal =
    prevDif <= prevDea && lastDif > lastDea
      ? 'golden_cross' as const
      : prevDif >= prevDea && lastDif < lastDea
        ? 'death_cross' as const
        : 'none' as const;

  // Overall signal scoring
  const lastClose = closes[closes.length - 1];
  let score = 0;
  if (lastClose > last(ma5)) score++;
  if (lastClose > last(ma20)) score++;
  if (last(macd.histogram) > 0) score++;
  const lastRsi = last(rsi);
  if (lastRsi > 50 && lastRsi < 70) score++;
  if (last(kdj.j) > last(kdj.k)) score++;

  const overallSignal: IndicatorResult['overallSignal'] =
    score >= 4 ? 'bullish' : score <= 1 ? 'bearish' : 'neutral';

  return {
    ma: { ma5: last(ma5), ma10: last(ma10), ma20: last(ma20), ma60: last(ma60) },
    ema: { ema12: last(ema12), ema26: last(ema26) },
    macd: { dif: lastDif, dea: lastDea, histogram: last(macd.histogram), signal: macdSignal },
    rsi: lastRsi,
    boll: {
      upper: last(boll.upper),
      mid: last(boll.mid),
      lower: last(boll.lower),
      width: last(boll.upper) - last(boll.lower),
    },
    kdj: { k: last(kdj.k), d: last(kdj.d), j: last(kdj.j) },
    volume: {
      avg5: volAvg5,
      avg20: volAvg20,
      ratio: volRatio,
      trend:
        volRatio > 1.3 ? 'increasing' : volRatio < 0.7 ? 'decreasing' : 'stable',
    },
    overallSignal,
  };
}
