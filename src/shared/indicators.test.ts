import { describe, expect, it } from 'vitest';
import { computeAllIndicators } from './indicators';

describe('computeAllIndicators', () => {
  it('returns NaN for long-period indicators when the kline series is too short', () => {
    const indicators = computeAllIndicators([
      { date: '1', open: 10, high: 11, low: 9, close: 10.2, volume: 10 },
      { date: '2', open: 10.2, high: 10.8, low: 10, close: 10.5, volume: 11 },
      { date: '3', open: 10.5, high: 10.9, low: 10.1, close: 10.3, volume: 9 },
      { date: '4', open: 10.3, high: 10.7, low: 10.1, close: 10.6, volume: 12 },
      { date: '5', open: 10.6, high: 11, low: 10.4, close: 10.8, volume: 13 },
    ]);

    expect(indicators.ma.ma20).toBeNaN();
    expect(indicators.boll.mid).toBeNaN();
    expect(indicators.boll.upper).toBeNaN();
    expect(indicators.boll.lower).toBeNaN();
  });
});
