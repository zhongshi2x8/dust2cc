import type { PageSnapshot } from './types';

export function buildAnalysisFingerprint(snapshot: PageSnapshot): string {
  const goodsId = snapshot.goodsInfo?.id || '';
  const goodsName = snapshot.goodsInfo?.name || '';
  const klineLength = snapshot.kline.length;
  const lastClose = snapshot.kline[snapshot.kline.length - 1]?.close ?? 0;
  const currentPrice = snapshot.price?.current ?? 0;
  const klineTail = snapshot.kline
    .slice(-3)
    .map((point) => [
      point.date,
      Number.isFinite(point.close) ? point.close.toFixed(2) : '0.00',
      Number.isFinite(point.high) ? point.high.toFixed(2) : '0.00',
      Number.isFinite(point.low) ? point.low.toFixed(2) : '0.00',
    ].join('@'))
    .join('|');

  return [
    goodsId,
    goodsName,
    klineLength,
    Number.isFinite(lastClose) ? lastClose.toFixed(2) : '0.00',
    Number.isFinite(currentPrice) ? currentPrice.toFixed(2) : '0.00',
    klineTail,
  ].join(':');
}
