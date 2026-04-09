import { describe, expect, it } from 'vitest';
import { generateQuickSignal } from './trade-signal';
import type { IndicatorResult } from '../types';

const invalidIndicators: IndicatorResult = {
  ma: { ma5: 440.9, ma10: 442.5, ma20: Number.NaN, ma60: Number.NaN },
  ema: { ema12: 0, ema26: 0 },
  macd: { dif: 0, dea: 0, histogram: Number.NaN, signal: 'none' },
  rsi: Number.NaN,
  boll: { upper: Number.NaN, mid: Number.NaN, lower: Number.NaN, width: Number.NaN },
  kdj: { k: Number.NaN, d: Number.NaN, j: Number.NaN },
  volume: { avg5: 97, avg20: Number.NaN, ratio: Number.NaN, trend: 'stable' },
  overallSignal: 'neutral',
};

describe('generateQuickSignal', () => {
  it('falls back to sane positive trading levels when long-period indicators are unavailable', () => {
    const signal = generateQuickSignal(464.5, invalidIndicators, []);

    expect(signal.support).toBeGreaterThan(0);
    expect(signal.stopLoss).toBeGreaterThan(0);
    expect(signal.stopLoss).toBeLessThan(464.5);
    expect(signal.resistance).toBeGreaterThan(signal.support ?? 0);
    expect(signal.target).toBeGreaterThan(0);
  });
});
