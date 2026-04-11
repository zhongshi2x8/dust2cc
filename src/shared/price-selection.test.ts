import { describe, expect, it } from 'vitest';
import {
  getBestReferenceDeltaRatio,
  isPriceAlignedWithReference,
  isPriceAlignedWithReferences,
  pickBestPriceCandidate,
  pickPreferredObservedPrice,
  resolveBestAnalysisPrice,
  shouldRetainKlineDespitePriceMismatch,
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

  it('does not blindly keep the primary price when it sharply disagrees with a trusted reference', () => {
    const result = pickPreferredObservedPrice(
      { value: 1280, weight: 0 },
      { value: 35980, weight: 0 },
      35989.5,
    );

    expect(result?.value).toBe(35980);
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

describe('resolveBestAnalysisPrice', () => {
  it('prefers the kline close when stale page price is far below the locked main chart', () => {
    expect(resolveBestAnalysisPrice(1259, 35989.5)).toBe(35989.5);
  });

  it('prefers the fresh observed page price when it matches the main chart', () => {
    expect(resolveBestAnalysisPrice(1259, 35989.5, 35980)).toBe(35980);
  });

  it('keeps the current price when it is aligned with the reference close', () => {
    expect(resolveBestAnalysisPrice(35988, 35989.5)).toBe(35988);
  });

  it('prefers the reference close over a far-off observed price when both disagree', () => {
    expect(resolveBestAnalysisPrice(1280, 35989.5, 1278)).toBe(35989.5);
  });
});

describe('shouldRetainKlineDespitePriceMismatch', () => {
  it('retains an echarts kline even when page price mismatches', () => {
    expect(shouldRetainKlineDespitePriceMismatch('echarts', 12)).toBe(true);
  });

  it('retains an already accepted network kline instead of clearing analysis state', () => {
    expect(shouldRetainKlineDespitePriceMismatch('network', 42)).toBe(true);
  });

  it('does not retain kline when nothing has ever been accepted', () => {
    expect(shouldRetainKlineDespitePriceMismatch(null, Number.NEGATIVE_INFINITY)).toBe(false);
  });
});
