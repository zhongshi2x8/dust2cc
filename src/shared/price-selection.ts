export interface PriceCandidate {
  value?: number;
  weight?: number;
}

function isFinitePositive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function normalizeReferencePrices(
  referencePrice?: number | Array<number | undefined>,
): number[] {
  if (Array.isArray(referencePrice)) {
    return referencePrice.filter(isFinitePositive);
  }

  return isFinitePositive(referencePrice) ? [referencePrice] : [];
}

export function isPriceAlignedWithReference(
  value?: number,
  referencePrice?: number,
  maxDeltaRatio = 0.28,
): boolean {
  if (!isFinitePositive(value) || !isFinitePositive(referencePrice)) return true;
  return Math.abs(value - referencePrice) / referencePrice <= maxDeltaRatio;
}

export function isPriceAlignedWithReferences(
  value?: number,
  referencePrice?: number | Array<number | undefined>,
  maxDeltaRatio = 0.28,
): boolean {
  if (!isFinitePositive(value)) return false;

  const references = normalizeReferencePrices(referencePrice);
  if (!references.length) return true;

  return references.some((candidate) => isPriceAlignedWithReference(value, candidate, maxDeltaRatio));
}

export function getBestReferenceDeltaRatio(
  value?: number,
  referencePrice?: number | Array<number | undefined>,
): number | undefined {
  if (!isFinitePositive(value)) return undefined;

  const references = normalizeReferencePrices(referencePrice);
  if (!references.length) return undefined;

  return references.reduce<number | undefined>((best, candidate) => {
    const next = Math.abs(value - candidate) / candidate;
    if (best === undefined || next < best) return next;
    return best;
  }, undefined);
}

function getReferenceScore(
  value: number,
  referencePrice?: number | Array<number | undefined>,
): number {
  const deltaRatio = getBestReferenceDeltaRatio(value, referencePrice);
  if (deltaRatio === undefined) return 0;

  if (deltaRatio <= 0.08) return 30;
  if (deltaRatio <= 0.2) return 18;
  if (deltaRatio <= 0.5) return 8;
  if (deltaRatio <= 0.8) return -5;
  return -20;
}

export function pickBestPriceCandidate<T extends PriceCandidate>(
  candidates: T[],
  referencePrice?: number | Array<number | undefined>,
): T | undefined {
  let bestCandidate: T | undefined;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const candidate of candidates) {
    if (!isFinitePositive(candidate.value)) continue;

    const score =
      (candidate.weight ?? 0) +
      getReferenceScore(candidate.value, referencePrice);

    if (score > bestScore) {
      bestScore = score;
      bestCandidate = candidate;
    }
  }

  return bestCandidate;
}

export function pickPreferredObservedPrice<T extends PriceCandidate>(
  primary?: T | null,
  fallback?: T | null,
  referencePrice?: number | Array<number | undefined>,
): T | undefined {
  if (isFinitePositive(primary?.value) && isFinitePositive(fallback?.value)) {
    const deltaRatio = Math.abs(primary.value - fallback.value) / Math.max(primary.value, fallback.value);
    if (deltaRatio >= 0.35 && primary.value >= fallback.value) {
      return primary;
    }
  }

  return pickBestPriceCandidate(
    [primary, fallback].filter(Boolean).map((candidate, index) => ({
      ...candidate,
      weight: (candidate?.weight ?? 0) + (index === 0 ? 16 : 0),
    })) as T[],
    referencePrice,
  );
}

export function resolveBestAnalysisPrice(
  currentPrice?: number,
  referencePrice?: number,
  observedPrice?: number,
): number {
  if (
    isFinitePositive(referencePrice) &&
    !isPriceAlignedWithReference(currentPrice, referencePrice, 0.28) &&
    !isPriceAlignedWithReference(observedPrice, referencePrice, 0.28)
  ) {
    return referencePrice;
  }

  const candidates = [
    { value: observedPrice, weight: 18 },
    { value: currentPrice, weight: 14 },
    { value: referencePrice, weight: 12 },
  ];

  const references = [referencePrice, observedPrice];
  return (
    pickBestPriceCandidate(candidates, references)?.value ??
    referencePrice ??
    observedPrice ??
    currentPrice ??
    0
  );
}

export function shouldRetainKlineDespitePriceMismatch(
  source: 'network' | 'echarts' | null,
  acceptedScore: number,
): boolean {
  if (source === 'echarts') return true;
  return Number.isFinite(acceptedScore) && acceptedScore > Number.NEGATIVE_INFINITY;
}
