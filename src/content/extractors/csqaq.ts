// ============================================================
// csqaq.com Extractor — DOM-based data extraction (fallback)
// ============================================================

import type { GoodsInfo, PriceInfo, KlinePoint, SiteAdapter, ApiPattern } from '@shared/types';

export class CsqaqExtractor implements SiteAdapter {
  name = 'csqaq' as const;
  matchUrl = /csqaq\.com\//;

  /** Extract goods ID from current URL */
  getGoodsId(): string | null {
    const pathnameMatch = window.location.pathname.match(/\/(?:goods|detail|item)\/(\d+)/);
    if (pathnameMatch) return pathnameMatch[1];

    const genericIdMatch = window.location.pathname.match(/\/(\d+)(?:\/)?$/);
    if (genericIdMatch) return genericIdMatch[1];

    const searchParams = new URLSearchParams(window.location.search);
    return (
      searchParams.get('id') ||
      searchParams.get('goodsId') ||
      searchParams.get('good_id') ||
      searchParams.get('itemId')
    );
  }

  /** Extract item name from page DOM */
  extractGoodsInfo(): GoodsInfo | null {
    const titleName = this.extractGoodsNameFromTitle();
    if (titleName) {
      return {
        id: this.getGoodsId() || '',
        name: titleName,
        source: 'csqaq',
      };
    }

    const selectors = [
      '[class*="detail"] h1',
      '[class*="detail"] [class*="name"]',
      '[class*="detail"] [class*="title"]',
      '[class*="goods-detail"] h1',
      '[class*="goods-detail"] [class*="name"]',
      '[class*="item-detail"] h1',
      'main h1',
      'main [class*="detail"] [class*="title"]',
    ];

    let bestName: string | null = null;
    let bestScore = Number.NEGATIVE_INFINITY;

    for (const sel of selectors) {
      const elements = document.querySelectorAll<HTMLElement>(sel);
      for (const el of elements) {
        const text = this.cleanText(el.textContent);
        if (!this.isLikelyGoodsName(text)) continue;

        const score = this.scoreGoodsNameElement(el, text, titleName);
        if (score > bestScore) {
          bestScore = score;
          bestName = text;
        }
      }
    }

    if (!bestName) return null;

    return {
      id: this.getGoodsId() || '',
      name: bestName,
      source: 'csqaq',
    };
  }

  /** Extract current price from page DOM */
  extractPrice(): PriceInfo | null {
    const selectors = [
      '[class*="detail"] [class*="price"]',
      '[class*="priceTag"]',
      '[class*="depositPrice"]',
      '[class*="price"]',
      '[class*="Price"]',
      '[data-price]',
    ];

    for (const sel of selectors) {
      const elements = document.querySelectorAll(sel);
      for (const el of elements) {
        const text = el.textContent?.trim() || '';
        const match = text.match(/[¥￥]?\s*([\d,]+\.?\d*)/);
        if (match) {
          const price = parseFloat(match[1].replace(/,/g, ''));
          if (price > 0 && price < 10_000_000) {
            return { current: price, currency: 'CNY' };
          }
        }
      }
    }
    return null;
  }

  /** Find the chart container element (for injecting our panel nearby) */
  getChartAnchor(): HTMLElement | null {
    const candidates = Array.from(document.querySelectorAll<HTMLElement>([
      '[class*="card_kline"]',
      '[class*="card_daily"]',
      '[class*="kline"]',
      '[class*="daily"]',
      '[class*="trend"]',
      '[class*="history"]',
      '[class*="chart"]',
      '[class*="Chart"]',
      '[_echarts_instance_]',
    ].join(',')));

    let bestCandidate: HTMLElement | null = null;
    let bestScore = Number.NEGATIVE_INFINITY;

    for (const candidate of candidates) {
      const container = this.resolveChartContainer(candidate);
      if (!container) continue;

      const score = this.scoreChartContainer(container);
      if (score > bestScore) {
        bestScore = score;
        bestCandidate = container;
      }
    }

    return bestCandidate;
  }

  private resolveChartContainer(el: HTMLElement): HTMLElement | null {
    return (
      el.closest<HTMLElement>('[class*="card_kline"]') ||
      el.closest<HTMLElement>('[class*="card_daily"]') ||
      el.closest<HTMLElement>('[class*="kline"]') ||
      el.closest<HTMLElement>('[class*="daily"]') ||
      el.closest<HTMLElement>('[class*="trend"]') ||
      el.closest<HTMLElement>('[class*="history"]') ||
      el.closest<HTMLElement>('[class*="chart"]') ||
      el.parentElement
    );
  }

  private scoreChartContainer(container: HTMLElement): number {
    const text = `${container.className} ${container.id} ${container.textContent || ''}`.toLowerCase();
    let score = 0;

    if (/kline|k_line|candlestick|daily|trend|history/.test(text)) score += 6;
    if (/card_kline|card_daily/.test(text)) score += 8;
    if (/price|market|line/.test(text)) score += 2;

    if (/筹码|distribution|chip|depth|order|sell|buy/.test(text)) score -= 12;

    const rect = container.getBoundingClientRect();
    if (rect.width > 280 && rect.height > 180) score += 2;

    return score;
  }

  private extractGoodsNameFromTitle(): string | null {
    const title = this.cleanText(document.title);
    if (!title) return null;

    const cleaned = title
      .replace(/\s*[-_|]\s*CSQAQ.*$/i, '')
      .replace(/\s*[-_|]\s*CS2 AI Analyst.*$/i, '')
      .trim();

    return this.isLikelyGoodsName(cleaned) ? cleaned : null;
  }

  private cleanText(value?: string | null): string {
    return value?.replace(/\s+/g, ' ').trim() || '';
  }

  private isLikelyGoodsName(value?: string | null): boolean {
    const text = this.cleanText(value);
    if (!text || text.length < 3 || text.length > 120) return false;
    if (!/[A-Za-z\u4e00-\u9fa5]/.test(text)) return false;
    if (/^(csqaq|steam|buff)$/i.test(text)) return false;
    if (/安全信息|security information|remote control/i.test(text)) return false;
    if (/^(在售|求购|成交|详情|走势图|价格走势|K线|库存|立即购买)$/i.test(text)) return false;
    return true;
  }

  private scoreGoodsNameElement(
    element: HTMLElement,
    text: string,
    titleName: string | null,
  ): number {
    let score = 0;
    const context = `${element.className} ${element.id}`.toLowerCase();
    const parentContext = `${element.parentElement?.className || ''} ${element.closest('main')?.className || ''}`.toLowerCase();
    const rect = element.getBoundingClientRect();

    if (titleName && text === titleName) score += 12;
    if (/detail|goods|item|title|name/.test(context)) score += 6;
    if (/detail|goods|item/.test(parentContext)) score += 4;
    if (/recommend|swiper|carousel|list|grid|hot|guess|sell/.test(`${context} ${parentContext}`)) score -= 8;
    if (rect.top >= 0 && rect.top < window.innerHeight * 0.7) score += 2;
    if (rect.width > 80) score += 1;

    return score;
  }

  /** API URL patterns to match intercepted requests */
  getApiPatterns(): ApiPattern[] {
    return [
      {
        urlPattern: /api\/v1\/info\/chart|api\/v1\/info\/simple\/chartAll|api\/v1\/sub\/kline|kline|chart|trend/i,
        dataType: 'kline',
        normalize: normalizeKlineResponse,
      },
      {
        urlPattern: /api\/v1\/info\/good(\?|\/|$)|goods\/detail|goods\/info|item\/info/i,
        dataType: 'goods_detail',
        normalize: normalizeGoodsDetailResponse,
      },
      {
        urlPattern: /api\/v1\/info\/good\/statistic|listing|sell_order|on_sale/i,
        dataType: 'listings',
        normalize: (raw) => raw,
      },
      {
        urlPattern: /wear|float/i,
        dataType: 'wear_distribution',
        normalize: (raw) => raw,
      },
    ];
  }
}

/** Normalize K-line API response to our standard format */
function normalizeKlineResponse(raw: unknown): KlinePoint[] {
  // csqaq K-line response format varies — handle multiple possibilities
  const data = raw as Record<string, unknown>;

  // Try: { data: { list: [...] } }
  const list =
    (data.data as Record<string, unknown>)?.list ??
    (data.data as Record<string, unknown>)?.kline ??
    data.data ??
    data.list ??
    data;

  if (!Array.isArray(list)) return [];

  return list.map((item: Record<string, unknown>) => ({
    date: String(item.time || item.date || item.ts || item.t || item.timestamp || ''),
    open: Number(item.open || item.o || 0),
    high: Number(item.high || item.h || 0),
    low: Number(item.low || item.l || 0),
    close: Number(item.close || item.c || 0),
    volume: Number(item.volume || item.vol || item.v || 0),
  }));
}

function normalizeGoodsDetailResponse(raw: unknown): GoodsInfo | null {
  const root = raw as Record<string, unknown>;
  const data = root.data as Record<string, unknown> | undefined;
  const info = (data?.goods_info ?? data ?? root) as Record<string, unknown>;
  const name =
    info.market_hash_name ||
    info.name ||
    info.goodsName ||
    info.title;

  if (typeof name !== 'string' || !name.trim()) return null;

  return {
    id: String(info.good_id || info.goods_id || info.id || ''),
    name,
    zhName: typeof info.goods_name === 'string' ? info.goods_name : undefined,
    weapon: typeof info.weapon === 'string' ? info.weapon : undefined,
    rarity: typeof info.rarity === 'string' ? info.rarity : undefined,
    wear: typeof info.exterior_localized_name === 'string' ? info.exterior_localized_name : undefined,
    iconUrl: typeof info.icon_url === 'string' ? info.icon_url : undefined,
    source: 'csqaq',
  };
}

export const csqaqExtractor = new CsqaqExtractor();
