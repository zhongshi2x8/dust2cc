import type { KlinePoint } from './types';

function toFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function pickFiniteNumber(record: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = toFiniteNumber(record[key]);
    if (value !== undefined) return value;
  }
  return undefined;
}

function pickValidPrice(record: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = toFiniteNumber(record[key]);
    if (value !== undefined && value > 0) return value;
  }
  return undefined;
}

function normalizeTimestamp(value: unknown, index: number): string {
  const numeric = toFiniteNumber(value);
  if (numeric !== undefined && numeric > 0) {
    const millis = numeric > 1_000_000_000_000 ? numeric : numeric * 1000;
    return new Date(millis).toISOString();
  }

  if (typeof value === 'string' && value.trim()) return value;
  return `point-${index}`;
}

export function detectTupleKlineFormat(list: unknown[][]): 'ohlc' | 'price-trend' {
  const sample = list.filter((item) => Array.isArray(item) && item.length >= 5).slice(0, 8);
  if (!sample.length) return 'price-trend';

  const ohlcHits = sample.filter((tuple) => {
    const open = toFiniteNumber(tuple[1]);
    const close = toFiniteNumber(tuple[2]);
    const high = toFiniteNumber(tuple[3]);
    const low = toFiniteNumber(tuple[4]);

    if (
      open === undefined ||
      close === undefined ||
      high === undefined ||
      low === undefined ||
      open <= 0 ||
      close <= 0 ||
      high <= 0 ||
      low <= 0
    ) {
      return false;
    }

    return high >= Math.max(open, close) && low <= Math.min(open, close) && high >= low;
  }).length;

  return ohlcHits >= Math.max(1, Math.ceil(sample.length / 2)) ? 'ohlc' : 'price-trend';
}

function normalizeOhlcTupleList(list: unknown[][]): KlinePoint[] {
  const points: KlinePoint[] = [];

  for (let index = 0; index < list.length; index++) {
    const tuple = list[index];
    if (!Array.isArray(tuple) || tuple.length < 5) continue;

    const open = toFiniteNumber(tuple[1]);
    const close = toFiniteNumber(tuple[2]);
    const high = toFiniteNumber(tuple[3]);
    const low = toFiniteNumber(tuple[4]);
    if (
      open === undefined ||
      close === undefined ||
      high === undefined ||
      low === undefined ||
      open <= 0 ||
      close <= 0 ||
      high <= 0 ||
      low <= 0
    ) {
      continue;
    }

    points.push({
      date: normalizeTimestamp(tuple[0], index),
      open,
      close,
      high,
      low,
      volume: toFiniteNumber(tuple[5]) ?? 0,
    });
  }

  return sanitizeKlinePoints(points);
}

function synthesizeOhlcFromTupleList(list: unknown[][]): KlinePoint[] {
  const points: KlinePoint[] = [];

  for (let index = 0; index < list.length; index++) {
    const tuple = list[index];
    if (!Array.isArray(tuple) || tuple.length < 2) continue;

    const sellPrice = toFiniteNumber(tuple[1]);
    const biddingPrice = toFiniteNumber(tuple[3]);
    const priceCandidates = [sellPrice, biddingPrice].filter(
      (value): value is number => value !== undefined && value > 0,
    );
    const close = priceCandidates[0];
    if (!close) continue;

    const previousTuple = index > 0 ? list[index - 1] : null;
    const previousCandidates =
      previousTuple && Array.isArray(previousTuple)
        ? [toFiniteNumber(previousTuple[1]), toFiniteNumber(previousTuple[3])].filter(
            (value): value is number => value !== undefined && value > 0,
          )
        : [];
    const open = previousCandidates[0] ?? close;
    const high = Math.max(open, close, ...priceCandidates, ...(previousCandidates.length ? previousCandidates : [open]));
    const low = Math.min(open, close, ...priceCandidates, ...(previousCandidates.length ? previousCandidates : [open]));

    points.push({
      date: normalizeTimestamp(tuple[0], index),
      open,
      high,
      low,
      close,
      volume:
        toFiniteNumber(tuple[6]) ??
        toFiniteNumber(tuple[2]) ??
        toFiniteNumber(tuple[4]) ??
        toFiniteNumber(tuple[5]) ??
        0,
    });
  }

  return sanitizeKlinePoints(points);
}

export function normalizeTupleKlineList(list: unknown[][]): KlinePoint[] {
  return detectTupleKlineFormat(list) === 'ohlc'
    ? normalizeOhlcTupleList(list)
    : synthesizeOhlcFromTupleList(list);
}

export function normalizePriceLikeKlineRecords(list: Array<Record<string, unknown>>): KlinePoint[] {
  const points: KlinePoint[] = [];
  let previousClose: number | undefined;

  for (let index = 0; index < list.length; index++) {
    const item = list[index];
    const close = pickValidPrice(item, [
      'close',
      'closePrice',
      'c',
      'price',
      'avgPrice',
      'sellPrice',
      'biddingPrice',
      'transactionPrice',
    ]);
    if (!close) continue;

    const open = pickValidPrice(item, ['open', 'openPrice', 'o']) ?? previousClose ?? close;
    const explicitHigh = pickValidPrice(item, ['high', 'highPrice', 'h', 'maxPrice']);
    const explicitLow = pickValidPrice(item, ['low', 'lowPrice', 'l', 'minPrice']);
    const spreadCandidates = [
      close,
      open,
      pickValidPrice(item, ['sellPrice']),
      pickValidPrice(item, ['biddingPrice']),
    ].filter((value): value is number => value !== undefined && value > 0);

    points.push({
      date: normalizeTimestamp(
        item.date ??
          item.time ??
          item.ts ??
          item.t ??
          item.timestamp ??
          item.createTime ??
          item.tradeDate ??
          item.endTime ??
          item.updateTime,
        index,
      ),
      open,
      high: explicitHigh ?? Math.max(...spreadCandidates),
      low: explicitLow ?? Math.min(...spreadCandidates),
      close,
      volume:
        pickFiniteNumber(item, [
          'volume',
          'vol',
          'v',
          'tradeNum',
          'count',
          'transactionCount',
          'sellCount',
          'biddingCount',
          'transactionAmount',
        ]) ?? 0,
    });

    previousClose = close;
  }

  return sanitizeKlinePoints(points);
}

export function sanitizeKlinePoints(points: KlinePoint[]): KlinePoint[] {
  const normalized = points
    .filter((point) =>
      [point.open, point.high, point.low, point.close].every(
        (value) => Number.isFinite(value) && value > 0,
      ),
    )
    .map((point, index) => ({
      ...point,
      date: point.date || `point-${index}`,
      high: Math.max(point.high, point.open, point.close, point.low),
      low: Math.min(point.low, point.open, point.close, point.high),
      volume: Number.isFinite(point.volume) ? point.volume : 0,
    }));

  return trimTrailingOutlierPoints(normalized);
}

function trimTrailingOutlierPoints(points: KlinePoint[]): KlinePoint[] {
  const trimmed = [...points];

  while (trimmed.length >= 25) {
    const tail = trimmed[trimmed.length - 1];
    const recent = trimmed.slice(-21, -1).map((point) => point.close).filter((value) => Number.isFinite(value) && value > 0);
    if (recent.length < 12) break;

    const anchor = median(recent);
    if (!Number.isFinite(anchor) || anchor <= 0) break;

    const ratio = tail.close / anchor;
    const openRatio = tail.open / anchor;
    const highRatio = tail.high / anchor;
    const lowRatio = tail.low / anchor;
    const isExtremeTail =
      ratio < 0.12 ||
      ratio > 8 ||
      openRatio < 0.12 ||
      openRatio > 8 ||
      highRatio < 0.12 ||
      highRatio > 8 ||
      lowRatio < 0.12 ||
      lowRatio > 8;

    if (!isExtremeTail) break;
    trimmed.pop();
  }

  return trimmed;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }
  return sorted[middle];
}
