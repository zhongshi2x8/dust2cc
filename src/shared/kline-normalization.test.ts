import { describe, expect, it } from 'vitest';
import {
  detectTupleKlineFormat,
  normalizePriceLikeKlineRecords,
  normalizeTupleKlineList,
} from './kline-normalization';

describe('detectTupleKlineFormat', () => {
  it('recognizes OHLC tuples from steamdt klinecharts payloads', () => {
    expect(
      detectTupleKlineFormat([
        [1775747860, 463.2, 464.8, 470.1, 460.5, 12000, 5300000],
        [1775834260, 464.8, 462.9, 468.3, 461.7, 9000, 4100000],
      ]),
    ).toBe('ohlc');
  });

  it('keeps trend tuples in price-trend mode', () => {
    expect(
      detectTupleKlineFormat([
        [1775747860, 463.2, 10, 460.5, 4, 12000, 6],
        [1775834260, 464.8, 12, 462.1, 5, 15000, 8],
      ]),
    ).toBe('price-trend');
  });
});

describe('normalizeTupleKlineList', () => {
  it('preserves OHLC tuples without re-synthesizing them', () => {
    const points = normalizeTupleKlineList([
      [1775747860, 463.2, 464.8, 470.1, 460.5, 12000, 5300000],
      [1775834260, 464.8, 462.9, 468.3, 461.7, 9000, 4100000],
    ]);

    expect(points).toHaveLength(2);
    expect(points[0]).toMatchObject({
      open: 463.2,
      close: 464.8,
      high: 470.1,
      low: 460.5,
      volume: 12000,
    });
    expect(points[1]).toMatchObject({
      open: 464.8,
      close: 462.9,
      high: 468.3,
      low: 461.7,
      volume: 9000,
    });
  });
});

describe('normalizePriceLikeKlineRecords', () => {
  it('synthesizes OHLC from sellPrice/biddingPrice trend records', () => {
    const points = normalizePriceLikeKlineRecords([
      { endTime: 1775747860, sellPrice: 463.2, sellCount: 10, biddingPrice: 460.5, biddingCount: 4, transactionCount: 6 },
      { endTime: 1775834260, sellPrice: 464.8, sellCount: 12, biddingPrice: 462.1, biddingCount: 5, transactionCount: 8 },
    ]);

    expect(points).toHaveLength(2);
    expect(points[0].close).toBe(463.2);
    expect(points[0].low).toBe(460.5);
    expect(points[1].open).toBe(463.2);
    expect(points[1].close).toBe(464.8);
    expect(points[1].volume).toBe(8);
  });
});
