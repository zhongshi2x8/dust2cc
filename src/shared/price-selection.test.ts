import { describe, expect, it } from 'vitest';
import {
  getBestReferenceDeltaRatio,
  isPriceAlignedWithReference,
  isPriceAlignedWithReferences,
  pickBestPriceCandidate,
  pickPreferredObservedPrice,
} from './price-selection';

describe('pickBestPriceCandidate', () => {
  it('prefers the candidate closest to the latest kline close', () => {
    const result = pickBestPriceCandidate(
      [
        { value: 23, weight: 8 },
        { value: 459, weight: 8 },
      ],
      465,
    );

    expect(result?.value).toBe(459);
  });

  it('falls back to the reference close when the primary candidate is an obvious outlier', () => {
    const result = pickBestPriceCandidate(
      [
        { value: 23, weight: 12 },
        { value: 465, weight: 0 },
      ],
      465,
    );

    expect(result?.value).toBe(465);
  });

  it('keeps the fresh observed price when it sharply disagrees with stale fallback state', () => {
    const result = pickPreferredObservedPrice(
      { value: 459, weight: 0 },
      { value: 115, weight: 0 },
      115,
    );

    expect(result?.value).toBe(459);
  });

  it('can score against multiple trusted references and keep the closest valid price', () => {
    const result = pickBestPriceCandidate(
      [
        { value: 115, weight: 12 },
        { value: 463.5, weight: 8 },
      ],
      [463.8, 900],
    );

    expect(result?.value).toBe(463.5);
  });
});

describe('isPriceAlignedWithReference', () => {
  it('rejects a kline close that is far below the page main price', () => {
    expect(isPriceAlignedWithReference(115, 459, 0.25)).toBe(false);
  });

  it('accepts a kline close that is near the page main price', () => {
    expect(isPriceAlignedWithReference(464.5, 459, 0.25)).toBe(true);
  });
});

describe('reference helpers', () => {
  it('accepts a value that matches any trusted reference price', () => {
    expect(isPriceAlignedWithReferences(463.6, [115, 463.8], 0.25)).toBe(true);
  });

  it('returns the closest delta ratio among multiple references', () => {
    expect(getBestReferenceDeltaRatio(463.6, [115, 463.8])).toBeCloseTo(0.000431, 4);
  });
});
