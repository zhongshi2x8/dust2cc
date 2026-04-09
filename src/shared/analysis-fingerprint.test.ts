import { describe, expect, it } from 'vitest';
import { buildAnalysisFingerprint } from './analysis-fingerprint';

describe('buildAnalysisFingerprint', () => {
  it('changes when the latest close changes even if kline length stays the same', () => {
    const before = buildAnalysisFingerprint({
      goodsInfo: { id: '1', name: 'AWP', source: 'steamdt' },
      price: { current: 23, currency: 'CNY' },
      kline: [
        { date: 'a', open: 1, high: 2, low: 1, close: 23, volume: 1 },
        { date: 'b', open: 1, high: 2, low: 1, close: 24, volume: 1 },
      ],
    });

    const after = buildAnalysisFingerprint({
      goodsInfo: { id: '1', name: 'AWP', source: 'steamdt' },
      price: { current: 459, currency: 'CNY' },
      kline: [
        { date: 'a', open: 1, high: 2, low: 1, close: 460, volume: 1 },
        { date: 'b', open: 1, high: 2, low: 1, close: 464.5, volume: 1 },
      ],
    });

    expect(after).not.toBe(before);
  });

  it('changes when the tail candles change even if the latest close stays the same', () => {
    const before = buildAnalysisFingerprint({
      goodsInfo: { id: '1', name: 'AWP', source: 'steamdt' },
      price: { current: 463, currency: 'CNY' },
      kline: [
        { date: '2026-04-07', open: 450, high: 462, low: 448, close: 460, volume: 1 },
        { date: '2026-04-08', open: 460, high: 468, low: 458, close: 463, volume: 1 },
      ],
    });

    const after = buildAnalysisFingerprint({
      goodsInfo: { id: '1', name: 'AWP', source: 'steamdt' },
      price: { current: 463, currency: 'CNY' },
      kline: [
        { date: '2026-04-08', open: 452, high: 469, low: 451, close: 460, volume: 1 },
        { date: '2026-04-09', open: 460, high: 466, low: 455, close: 463, volume: 1 },
      ],
    });

    expect(after).not.toBe(before);
  });
});
