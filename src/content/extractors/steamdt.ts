// ============================================================
// steamdt.com Extractor — DOM + API data extraction
// ============================================================

import type { GoodsInfo, PriceInfo, KlinePoint, SiteAdapter, ApiPattern } from '@shared/types';
import { normalizePriceLikeKlineRecords, normalizeTupleKlineList } from '@shared/kline-normalization';
import { isPriceAlignedWithReference, pickBestPriceCandidate } from '@shared/price-selection';

export class SteamdtExtractor implements SiteAdapter {
  name = 'steamdt' as const;
  matchUrl = /steamdt\.com\//;

  canAnalyzeUrl(url: string): boolean {
    const kind = getSteamdtPageKind(url);
    return kind === 'item-detail' || kind === 'market-index';
  }

  /** Extract item name from URL path (encoded market_hash_name) */
  getItemNameFromUrl(): string | null {
    // URL pattern: /cs2/★ Sport Gloves | Hedge Maze (Field-Tested)
    const match = window.location.pathname.match(/\/cs2\/(.+)/);
    if (match) {
      try {
        return decodeURIComponent(match[1]).trim();
      } catch {
        return match[1].trim();
      }
    }
    return null;
  }

  /** Try to extract itemId from Nuxt hydration data */
  getItemId(): string | null {
    const currentRecord = this.findCurrentPageHydrationRecord();
    if (currentRecord) {
      const recordItemId = currentRecord.itemId ?? currentRecord.id ?? currentRecord.goodsId;
      if (typeof recordItemId === 'string' || typeof recordItemId === 'number') {
        return String(recordItemId);
      }
    }

    try {
      const nuxtData = (window as unknown as Record<string, unknown>).__NUXT__;
      if (nuxtData && typeof nuxtData === 'object') {
        const data = nuxtData as Record<string, unknown>;
        // Nuxt stores page data in state/payload
        const itemId = this.deepFind(data, 'itemId');
        if (typeof itemId === 'string' || typeof itemId === 'number') {
          return String(itemId);
        }
      }
    } catch {
      // Ignore hydration read failures
    }

    // Fallback: try to find in DOM data attributes
    const el = document.querySelector('[data-item-id]');
    if (el) return el.getAttribute('data-item-id');

    return null;
  }

  extractGoodsInfo(): GoodsInfo | null {
    const pageKind = getSteamdtPageKind(window.location.href, document.title);
    if (pageKind === 'market-index') {
      const marketRecord = this.findCurrentPageHydrationRecord();
      const recordName =
        typeof marketRecord?.name === 'string' && marketRecord.name.trim()
          ? marketRecord.name.trim()
          : null;
      const marketType = this.getSteamdtSectionType();
      return {
        id: `steamdt-market-index-${marketType || 'default'}`,
        name: recordName ? `SteamDT ${recordName}指数` : 'SteamDT 大盘指数',
        source: 'steamdt',
      };
    }

    const currentRecord = this.findCurrentPageHydrationRecord();
    if (currentRecord) {
      const resolvedName = [
        currentRecord.name,
        currentRecord.shortName,
        currentRecord.marketHashName,
        currentRecord.marketShortName,
      ].find((value) => typeof value === 'string' && value.trim()) as string | undefined;

      if (resolvedName) {
        const resolvedIdCandidate = currentRecord.itemId ?? currentRecord.id ?? currentRecord.goodsId;
        const resolvedId =
          resolvedIdCandidate !== undefined && resolvedIdCandidate !== null
            ? resolvedIdCandidate
            : (this.getItemId() || '');
        return {
          id: String(resolvedId),
          name: resolvedName,
          zhName: typeof currentRecord.shortName === 'string' ? currentRecord.shortName :
                  typeof currentRecord.cnName === 'string' ? currentRecord.cnName : undefined,
          weapon: typeof currentRecord.weapon === 'string' ? currentRecord.weapon : undefined,
          rarity: typeof currentRecord.rarity === 'string' ? currentRecord.rarity :
                  typeof currentRecord.rarityName === 'string' ? currentRecord.rarityName : undefined,
          wear: typeof currentRecord.exteriorName === 'string' ? currentRecord.exteriorName :
                typeof currentRecord.exterior === 'string' ? currentRecord.exterior : undefined,
          iconUrl: typeof currentRecord.iconUrl === 'string' ? currentRecord.iconUrl :
                   typeof currentRecord.imageUrl === 'string' ? currentRecord.imageUrl : undefined,
          source: 'steamdt',
        };
      }
    }

    // Strategy 1: From page title
    const titleName = this.extractFromTitle();
    if (titleName) {
      return {
        id: this.getItemId() || '',
        name: titleName,
        source: 'steamdt',
      };
    }

    // Strategy 2: From URL
    const urlName = this.getItemNameFromUrl();
    if (urlName && urlName.length > 3) {
      return {
        id: this.getItemId() || '',
        name: urlName,
        source: 'steamdt',
      };
    }

    // Strategy 3: From DOM - steamdt uses Vue/Nuxt with specific class patterns
    const selectors = [
      '.detail-header h1',
      '.detail-header [class*="name"]',
      '.detail-header [class*="title"]',
      '.goods-name',
      '.item-name',
      'h1',
      '.common-container h1',
      '.text-color-primary',
    ];

    for (const sel of selectors) {
      const el = document.querySelector<HTMLElement>(sel);
      if (el) {
        const text = el.textContent?.trim();
        if (text && text.length > 3 && text.length < 120 && /[A-Za-z\u4e00-\u9fa5]/.test(text)) {
          return {
            id: this.getItemId() || '',
            name: text,
            source: 'steamdt',
          };
        }
      }
    }

    return null;
  }

  extractPrice(): PriceInfo | null {
    const domPrice = this.extractPriceFromDom();
    const nuxtPrice = this.extractPriceFromNuxt(domPrice?.current);

    if (domPrice && nuxtPrice) {
      if (!isPriceAlignedWithReference(nuxtPrice.current, domPrice.current, 0.2)) {
        return nuxtPrice;
      }

      return {
        current: nuxtPrice.current,
        currency: 'CNY',
        changePercent24h: nuxtPrice.changePercent24h ?? domPrice.changePercent24h,
      };
    }

    return domPrice ?? nuxtPrice;
  }

  private extractPriceFromNuxt(referencePrice?: number): PriceInfo | null {
    try {
      const pageKind = getSteamdtPageKind(window.location.href, document.title);
      const currentRecord = this.findCurrentPageHydrationRecord();
      const source = currentRecord ?? this.getHydrationData();
      if (!source || typeof source !== 'object') return null;

      const currentCandidates =
        pageKind === 'market-index'
          ? [
              { value: this.parseNumber(this.readNestedValue(source, 'index')), weight: 28 },
              { value: this.parseNumber(this.readNestedValue(source, 'yesterdayIndex')), weight: 10 },
              { value: this.parseNumber(this.readNestedValue(source, 'highIndex')), weight: 8 },
              { value: this.parseNumber(this.readNestedValue(source, 'lowIndex')), weight: 8 },
            ]
          : [
              { value: this.parseNumber(this.readNestedValue(source, 'lowestPrice')), weight: 30 },
              { value: this.parseNumber(this.readNestedValue(source, 'sellMinPrice')), weight: 24 },
              { value: this.parseNumber(this.readNestedValue(source, 'currentPrice')), weight: 20 },
              { value: this.parseNumber(this.readNestedValue(source, 'consignmentBest.price')), weight: 18 },
              { value: this.parseNumber(this.readNestedValue(source, 'sellingPriceList.0.price')), weight: 14 },
              { value: this.parseNumber(this.readNestedValue(source, 'purchaseBest.price')), weight: 10 },
              { value: this.parseNumber(this.readNestedValue(source, 'sellPrice')), weight: 8 },
              { value: this.parseNumber(this.readNestedValue(source, 'price')), weight: 4 },
            ];

      const current = pickBestPriceCandidate(currentCandidates, referencePrice)?.value;

      if (current === undefined || current <= 0 || current >= 10_000_000) {
        return null;
      }

      const changeCandidates =
        pageKind === 'market-index'
          ? [
              this.parseNumber(this.readNestedValue(source, 'riseFallRate')),
              this.parseNumber(this.readNestedValue(source, 'changePercent24h')),
            ]
          : [
              this.parseNumber(this.readNestedValue(source, 'diff1Day')),
              this.parseNumber(this.readNestedValue(source, 'changePercent24h')),
              this.parseNumber(this.readNestedValue(source, 'priceChangePercent')),
              this.parseNumber(this.readNestedValue(source, 'ratio24h')),
              this.parseNumber(this.readNestedValue(source, 'price_change_percent')),
            ];

      return {
        current,
        currency: 'CNY',
        changePercent24h: changeCandidates.find((value) => typeof value === 'number' && Number.isFinite(value)),
      };
    } catch {
      return null;
    }
  }

  private getSteamdtSectionType(): string | null {
    try {
      const parsed = new URL(window.location.href);
      const type = parsed.searchParams.get('type');
      return type ? type.toUpperCase() : null;
    } catch {
      return null;
    }
  }

  private getHydrationData(): unknown {
    const script = document.getElementById('__NUXT_DATA__');
    const scriptText = script?.textContent?.trim();
    if (scriptText) {
      try {
        return JSON.parse(scriptText);
      } catch {
        // Ignore malformed hydration payloads.
      }
    }

    const nuxtData = (window as unknown as Record<string, unknown>).__NUXT__;
    return nuxtData && typeof nuxtData === 'object' ? nuxtData : null;
  }

  private findCurrentPageHydrationRecord(): Record<string, unknown> | null {
    const root = this.getHydrationData();
    if (!root || typeof root !== 'object') return null;

    const pageKind = getSteamdtPageKind(window.location.href, document.title);
    const itemNameCandidates = [
      this.getItemNameFromUrl(),
      this.extractFromTitle(),
      document.querySelector('h1')?.textContent?.trim() || null,
    ]
      .filter((value): value is string => !!value)
      .map((value) => this.normalizeIdentityText(value));

    const sectionType = this.getSteamdtSectionType();
    let bestRecord: Record<string, unknown> | null = null;
    let bestScore = Number.NEGATIVE_INFINITY;
    const seen = new WeakSet<object>();

    const visit = (value: unknown, depth = 0) => {
      if (depth > 8 || !value || typeof value !== 'object') return;
      if (seen.has(value as object)) return;
      seen.add(value as object);

      if (!Array.isArray(value)) {
        const record = value as Record<string, unknown>;
        const score = this.scoreHydrationRecord(record, pageKind, itemNameCandidates, sectionType);
        if (score > bestScore) {
          bestScore = score;
          bestRecord = record;
        }
      }

      for (const child of Object.values(value as Record<string, unknown>)) {
        visit(child, depth + 1);
      }
    };

    visit(root);
    return bestScore >= 20 ? bestRecord : null;
  }

  private scoreHydrationRecord(
    record: Record<string, unknown>,
    pageKind: 'item-detail' | 'market-index' | 'other',
    itemNameCandidates: string[],
    sectionType: string | null,
  ): number {
    let score = 0;
    const recordName = this.normalizeIdentityText(
      [
        record.marketHashName,
        record.name,
        record.shortName,
        record.marketShortName,
      ].find((value) => typeof value === 'string' && value.trim()) as string | undefined,
    );

    if (pageKind === 'market-index') {
      if (typeof record.type === 'string' && sectionType && record.type.toUpperCase() === sectionType) score += 40;
      if (typeof record.name === 'string' && /大盘|指数|板块/.test(record.name)) score += 18;
      if (typeof record.index !== 'undefined') score += 26;
      if (typeof record.yesterdayIndex !== 'undefined') score += 10;
      if (typeof record.highIndex !== 'undefined') score += 8;
      if (typeof record.lowIndex !== 'undefined') score += 8;
      if (typeof record.marketHashName === 'string' || typeof record.lowestPrice !== 'undefined') score -= 20;
      return score;
    }

    if (pageKind !== 'item-detail') return Number.NEGATIVE_INFINITY;

    if (recordName && itemNameCandidates.some((candidate) => candidate === recordName || candidate.includes(recordName) || recordName.includes(candidate))) {
      score += 36;
    }
    if (typeof record.itemId !== 'undefined' || typeof record.id !== 'undefined') score += 8;
    if (typeof record.lowestPrice !== 'undefined') score += 28;
    if (typeof record.sellMinPrice !== 'undefined') score += 24;
    if (typeof record.consignmentBest !== 'undefined') score += 18;
    if (Array.isArray(record.sellingPriceList)) score += 16;
    if (typeof record.purchaseBest !== 'undefined') score += 10;
    if (typeof record.platformName === 'string') score -= 16;
    if (typeof record.platform === 'string') score -= 8;
    if (typeof record.index !== 'undefined') score -= 24;

    return score;
  }

  private normalizeIdentityText(value?: string): string {
    if (!value) return '';
    return value
      .toLowerCase()
      .replace(/\s*[-_|]\s*steamdt.*$/i, '')
      .replace(/\s*[-_|]\s*cs2.*$/i, '')
      .replace(/[（）()]/g, ' ')
      .replace(/久经沙场/g, 'field-tested')
      .replace(/略有磨损/g, 'minimal wear')
      .replace(/破损不堪/g, 'well-worn')
      .replace(/战痕累累/g, 'battle-scarred')
      .replace(/崭新出厂/g, 'factory new')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private readNestedValue(source: unknown, path: string): unknown {
    if (!source || typeof source !== 'object' || !path) return undefined;

    const segments = path.split('.');
    let current: unknown = source;
    for (const segment of segments) {
      if (Array.isArray(current)) {
        const index = Number(segment);
        current = Number.isInteger(index) ? current[index] : undefined;
      } else if (current && typeof current === 'object') {
        current = (current as Record<string, unknown>)[segment];
      } else {
        return undefined;
      }
    }

    return current;
  }

  private extractPriceFromDom(): PriceInfo | null {
    const candidate = this.findBestPriceCandidateFromDom();
    if (!candidate) return null;

    return {
      current: candidate.value,
      currency: 'CNY',
      changePercent24h: candidate.changePercent,
    };
  }

  getPanelAnchor(): HTMLElement | null {
    const heroRoot = this.findHeroRoot();
    if (heroRoot) return heroRoot;

    const titleEl = document.querySelector<HTMLElement>(
      '.detail-header h1, .goods-name, .item-name, h1',
    );
    const priceEl = this.findBestPriceCandidateFromDom()?.element ?? null;
    const seedElements = [titleEl, priceEl].filter((value): value is HTMLElement => !!value);
    const candidates = new Set<HTMLElement>();

    for (const seed of seedElements) {
      let current: HTMLElement | null = seed;
      for (let depth = 0; depth < 5 && current; depth++) {
        candidates.add(current);
        current = current.parentElement;
      }
    }

    for (const el of document.querySelectorAll<HTMLElement>(
      '.detail-summary, [class*="detail"], [class*="summary"], [class*="overview"], [class*="info"], .common-container, main section',
    )) {
      candidates.add(el);
    }

    let bestAnchor: HTMLElement | null = null;
    let bestScore = Number.NEGATIVE_INFINITY;

    for (const candidate of candidates) {
      const score = this.scorePanelAnchor(candidate);
      if (score > bestScore) {
        bestScore = score;
        bestAnchor = candidate;
      }
    }

    return bestAnchor;
  }

  getChartAnchor(): HTMLElement | null {
    // Strategy 1: Direct ECharts instance (most reliable)
    let bestCandidate: HTMLElement | null = null;
    let bestScore = Number.NEGATIVE_INFINITY;

    for (const echartsEl of document.querySelectorAll<HTMLElement>('[_echarts_instance_]')) {
      const container = this.resolveChartContainer(echartsEl);
      if (!container) continue;

      const score = this.scoreChartContainer(container);
      if (score > bestScore) {
        bestScore = score;
        bestCandidate = container;
      }
    }

    // Strategy 2: Canvas inside a chart-like container
    const canvases = document.querySelectorAll<HTMLCanvasElement>('canvas');
    for (const canvas of canvases) {
      const parent = canvas.parentElement;
      if (!parent) continue;
      const rect = parent.getBoundingClientRect();
      if (rect.width > 280 && rect.height > 150) {
        const container = this.resolveChartContainer(parent);
        if (!container) continue;

        const score = this.scoreChartContainer(container);
        if (score > bestScore) {
          bestScore = score;
          bestCandidate = container;
        }
      }
    }

    // Strategy 3: Score-based search across candidate selectors
    const candidates = Array.from(document.querySelectorAll<HTMLElement>([
      '[class*="trend"]',
      '[class*="chart"]',
      '[class*="Chart"]',
      '[class*="kline"]',
      '[class*="graph"]',
      '.el-tabs',
      '[class*="history"]',
      '[class*="走势"]',
      '[class*="price-trend"]',
      '[class*="market-trend"]',
    ].join(',')));

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
    // Walk up to find a meaningful container, but not too far
    let current: HTMLElement | null = el;
    for (let depth = 0; depth < 5 && current; depth++) {
      const cls = `${current.className} ${current.id}`.toLowerCase();
      if (/trend|chart|kline|history|走势|graph/.test(cls)) {
        const rect = current.getBoundingClientRect();
        if (rect.width > 200 && rect.height > 120) return current;
      }
      current = current.parentElement;
    }

    // Fallback: el-tabs or direct parent
    const fallbacks = [
      el.closest<HTMLElement>('.el-tabs'),
      el.closest<HTMLElement>('[class*="trend"]'),
      el.closest<HTMLElement>('[class*="chart"]'),
      el.parentElement,
    ].filter((value): value is HTMLElement => !!value);

    return (
      fallbacks.find((candidate) => this.isElementVisible(candidate) && this.isElementInActivePane(candidate)) ||
      fallbacks.find((candidate) => this.isElementInActivePane(candidate)) ||
      fallbacks[0] ||
      null
    );
  }

  private scoreChartContainer(container: HTMLElement): number {
    const text = `${container.className} ${container.id} ${this.collectNearbyText(container)}`.toLowerCase();
    let score = 0;

    if (/trend|走势|kline|chart|history/.test(text)) score += 6;
    if (/price|market/.test(text)) score += 2;
    if (/tab/.test(text)) score += 1;
    if (/日k|日线|daily|1d/.test(text)) score += 10;
    if (/周k|周线|weekly|1w/.test(text)) score -= 4;
    // Bonus for having canvas or echarts inside
    if (container.querySelector('canvas') || container.querySelector('[_echarts_instance_]')) score += 4;
    // Penalize non-chart containers
    if (/nav|footer|header|banner|menu/.test(text)) score -= 10;
    if (/listing|sell|buy|order|wear|磨损|sidebar|related|recommend/.test(text)) score -= 8;

    if (this.isElementInActivePane(container)) score += 8;
    else score -= 18;
    if (this.isElementVisible(container)) score += 10;
    else score -= 24;

    const rect = container.getBoundingClientRect();
    if (rect.width > 760 && rect.height > 320) score += 12;
    else if (rect.width > 520 && rect.height > 240) score += 7;
    else if (rect.width > 280 && rect.height > 180) score += 2;
    if (rect.width < 100 || rect.height < 80) score -= 5;

    return score;
  }

  private extractFromTitle(): string | null {
    const title = document.title?.trim();
    if (!title) return null;

    const cleaned = title
      .replace(/\s*[-_|]\s*SteamDT.*$/i, '')
      .replace(/\s*[-_|]\s*Steam.*$/i, '')
      .replace(/\s*[-_|]\s*CS2.*$/i, '')
      .trim();

    if (cleaned.length > 3 && cleaned.length < 120 && /[A-Za-z\u4e00-\u9fa5]/.test(cleaned)) {
      return cleaned;
    }
    return null;
  }

  private deepFind(obj: unknown, key: string, depth = 0): unknown {
    if (depth > 6 || !obj || typeof obj !== 'object') return undefined;

    const record = obj as Record<string, unknown>;
    if (key in record) return record[key];

    for (const value of Object.values(record)) {
      if (value && typeof value === 'object') {
        const found = this.deepFind(value, key, depth + 1);
        if (found !== undefined) return found;
      }
    }
    return undefined;
  }

  private parseNumber(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const parsed = Number(value.replace(/[^\d.-]/g, ''));
      if (Number.isFinite(parsed)) return parsed;
    }

    return undefined;
  }

  private findBestPriceCandidateFromDom():
    | { element: HTMLElement; value: number; changePercent?: number }
    | null {
    const heroRoot = this.findHeroRoot();
    const titleEl = heroRoot?.querySelector<HTMLElement>('h1') ?? document.querySelector<HTMLElement>('h1');
    const priceSelectors = [
      '.detail-header [class*="price"]',
      '.detail-header [class*="Price"]',
      '.price-main',
      '.detail-price',
      '.selling-price',
      '[class*="summary"] [class*="price"]',
      '[class*="overview"] [class*="price"]',
      '[class*="detail"] [class*="price"]',
      '[class*="Price"]',
      '[class*="price"]',
      '[class*="money"]',
      '[class*="amount"]',
      '.text-color-primary',
    ];

    const candidates: Array<{
      element: HTMLElement;
      value: number;
      changePercent?: number;
      weight: number;
    }> = [];

    for (const sel of priceSelectors) {
      const elements = document.querySelectorAll<HTMLElement>(sel);
      for (const el of elements) {
        const value = this.parsePriceText(el.textContent?.trim() || '');
        if (value === undefined) continue;

        const changeEl = el.parentElement?.querySelector(
          '.text-color-red, .text-color-green, [class*="change"]',
        );
        const changeMatch = changeEl?.textContent?.match(/([+-]?\d+\.?\d*)%/);

        candidates.push({
          element: el,
          value,
          changePercent: changeMatch ? parseFloat(changeMatch[1]) : undefined,
          weight: this.scorePriceElement(el, value, heroRoot, titleEl),
        });
      }
    }

    return pickBestPriceCandidate(candidates) ?? null;
  }

  private parsePriceText(text: string): number | undefined {
    const match = text.match(/[¥￥]\s*([\d,]+\.?\d*)|(^|\s)([\d,]{2,}\.?\d*)($|\s)/);
    const rawValue = match?.[1] ?? match?.[3];
    if (!rawValue) return undefined;

    const price = parseFloat(rawValue.replace(/,/g, ''));
    if (!Number.isFinite(price) || price <= 0 || price >= 10_000_000) return undefined;

    return price;
  }

  private scorePriceElement(
    element: HTMLElement,
    value: number,
    heroRoot: HTMLElement | null,
    titleEl: HTMLElement | null,
  ): number {
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    const fontSize = parseFloat(style.fontSize || '0');
    const context = [
      element.className,
      element.id,
      element.parentElement?.className || '',
      element.closest('section')?.className || '',
    ]
      .join(' ')
      .toLowerCase();

    let score = 0;

    if (/detail|summary|overview|goods|item|header|price|money|amount/.test(context)) score += 12;
    if (/list|ranking|record|history|chart|trend|wear|order|tab/.test(context)) score -= 10;
    if (heroRoot && heroRoot.contains(element)) score += 18;
    if (titleEl && titleEl !== element) {
      const titleRect = titleEl.getBoundingClientRect();
      const verticalDistance = Math.abs(rect.top - titleRect.bottom);
      if (verticalDistance < 120) score += 8;
      else if (verticalDistance < 220) score += 4;
    }
    if ((element.textContent || '').includes('¥') || (element.textContent || '').includes('￥')) score += 6;
    if (fontSize >= 24) score += 8;
    else if (fontSize >= 18) score += 4;
    if (this.isElementVisible(element)) score += 4;
    else score -= 16;
    if (rect.top >= 0 && rect.top < window.innerHeight * 0.65) score += 3;
    if (rect.width > 80) score += 2;
    if (value >= 100) score += 2;

    return score;
  }

  private scorePanelAnchor(element: HTMLElement): number {
    const rect = element.getBoundingClientRect();
    const context = `${element.className} ${element.id}`.toLowerCase();
    let score = 0;

    if (element.querySelector('h1')) score += 12;
    if (element.querySelector('[class*="price"], [class*="Price"], .price-main')) score += 10;
    if (/detail|summary|overview|goods|item|info|common-container/.test(context)) score += 8;
    if (/chart|trend|kline|history|tab/.test(context)) score -= 14;
    if (rect.width > 640) score += 4;
    if (rect.height > 140) score += 3;
    if (rect.top >= 0 && rect.top < window.innerHeight * 0.45) score += 3;

    return score;
  }

  private findHeroRoot(): HTMLElement | null {
    const candidates = Array.from(document.querySelectorAll<HTMLElement>([
      '.detail-summary',
      '.detail-header',
      '[class*="detail"][class*="summary"]',
      '[class*="detail"][class*="header"]',
      '[class*="summary"]',
      '.common-container > section',
      '.common-container > div',
      'main section',
    ].join(',')));

    let best: HTMLElement | null = null;
    let bestScore = Number.NEGATIVE_INFINITY;

    for (const candidate of candidates) {
      const score = this.scoreHeroRoot(candidate);
      if (score > bestScore) {
        best = candidate;
        bestScore = score;
      }
    }

    return best;
  }

  private scoreHeroRoot(candidate: HTMLElement): number {
    const rect = candidate.getBoundingClientRect();
    const context = `${candidate.className} ${candidate.id} ${this.collectNearbyText(candidate)}`.toLowerCase();
    let score = 0;

    if (!this.isElementVisible(candidate)) return Number.NEGATIVE_INFINITY;
    if (/detail|summary|overview|header|goods|item/.test(context)) score += 12;
    if (candidate.querySelector('h1')) score += 12;
    if (candidate.querySelector('[class*="price"], [class*="Price"], .price-main, .text-color-primary')) score += 12;
    if (/chart|trend|kline|history|tab/.test(context)) score -= 14;
    if (rect.top >= 0 && rect.top < window.innerHeight * 0.55) score += 8;
    if (rect.width > 640) score += 4;
    if (rect.height > 120 && rect.height < 520) score += 3;

    return score;
  }

  private collectNearbyText(element: HTMLElement): string {
    const pieces = [
      element.textContent || '',
      element.parentElement?.textContent || '',
      element.previousElementSibling?.textContent || '',
      element.closest('.el-tabs')?.querySelector('.is-active, .active, [aria-selected="true"]')?.textContent || '',
    ];

    return pieces.join(' ').replace(/\s+/g, ' ').slice(0, 320);
  }

  private isElementVisible(element: HTMLElement): boolean {
    let current: HTMLElement | null = element;
    while (current) {
      const style = window.getComputedStyle(current);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
        return false;
      }
      if (current.hidden || current.getAttribute('aria-hidden') === 'true') {
        return false;
      }
      current = current.parentElement;
    }

    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  private isElementInActivePane(element: HTMLElement): boolean {
    const inactiveAncestor = element.closest<HTMLElement>('[hidden], [aria-hidden="true"], .is-hidden');
    if (inactiveAncestor) return false;

    const tabPane = element.closest<HTMLElement>('.el-tab-pane');
    if (tabPane) {
      if (tabPane.classList.contains('is-active')) return true;
      const style = window.getComputedStyle(tabPane);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
    }

    return true;
  }

  getApiPatterns(): ApiPattern[] {
    return [
      {
        // SteamDT trend/price history API
        urlPattern: /api\.steamdt\.com.*(?:trend|history|chart|kline|price.*list)/i,
        dataType: 'kline',
        normalize: normalizeSteamdtTrendResponse,
      },
      {
        // SteamDT item detail API
        urlPattern: /api\.steamdt\.com.*(?:detail|info|item)/i,
        dataType: 'goods_detail',
        normalize: normalizeSteamdtDetailResponse,
      },
      {
        // SteamDT selling/listing API
        urlPattern: /api\.steamdt\.com.*(?:selling|listing|on.?sale)/i,
        dataType: 'listings',
        normalize: (raw) => raw,
      },
    ];
  }
}

/** Normalize SteamDT trend data to KlinePoint[] */
export function normalizeSteamdtTrendResponse(raw: unknown): KlinePoint[] {
  if (!raw || typeof raw !== 'object') return [];

  const data = raw as Record<string, unknown>;

  // Try multiple response structures
  const trendList =
    (data.data as Record<string, unknown>)?.trendList ??
    (data.data as Record<string, unknown>)?.list ??
    (data.data as Record<string, unknown>)?.priceList ??
    (data.data as unknown[]) ??
    data.trendList ??
    data.list ??
    data;

  if (!Array.isArray(trendList)) return [];

  if (Array.isArray(trendList[0])) {
    return normalizeTupleKlineList(trendList as unknown[][]);
  }

  return normalizePriceLikeKlineRecords(
    trendList.filter((item: unknown): item is Record<string, unknown> => !!item && typeof item === 'object'),
  );
}

/** Normalize SteamDT item detail to GoodsInfo */
function normalizeSteamdtDetailResponse(raw: unknown): GoodsInfo | null {
  if (!raw || typeof raw !== 'object') return null;

  const root = raw as Record<string, unknown>;
  const data = (root.data ?? root) as Record<string, unknown>;

  const name =
    data.marketHashName ||
    data.market_hash_name ||
    data.name ||
    data.itemName ||
    data.goodsName;

  if (typeof name !== 'string' || !name.trim()) return null;

  return {
    id: String(data.itemId || data.id || data.goodsId || ''),
    name,
    zhName: typeof data.shortName === 'string' ? data.shortName :
            typeof data.cnName === 'string' ? data.cnName : undefined,
    weapon: typeof data.weapon === 'string' ? data.weapon : undefined,
    rarity: typeof data.rarity === 'string' ? data.rarity :
            typeof data.rarityName === 'string' ? data.rarityName : undefined,
    wear: typeof data.exteriorName === 'string' ? data.exteriorName :
          typeof data.exterior === 'string' ? data.exterior : undefined,
    iconUrl: typeof data.iconUrl === 'string' ? data.iconUrl :
             typeof data.imageUrl === 'string' ? data.imageUrl : undefined,
    source: 'steamdt',
  };
}

export const steamdtExtractor = new SteamdtExtractor();

export function isSteamdtDetailUrl(url: string): boolean {
  return getSteamdtPageKind(url) === 'item-detail';
}

export function getSteamdtPageKind(
  url: string,
  title: string = typeof document !== 'undefined' ? document.title : '',
): 'item-detail' | 'market-index' | 'other' {
  try {
    const parsed = new URL(url);
    if (!/steamdt\.com$/i.test(parsed.hostname)) return 'other';

    const pathname = decodeURIComponent(parsed.pathname);
    if (pathname === '/section' && (parsed.searchParams.get('type') || /大盘|指数|板块/i.test(title))) {
      return 'market-index';
    }
    if (pathname === '/' && /大盘|指数|inventory|价格走势/i.test(title)) {
      return 'market-index';
    }

    const match = pathname.match(/^\/cs2\/(.+)$/);
    if (!match) return 'other';

    const slug = match[1].trim().toLowerCase();
    if (!slug) return 'other';

    const reservedRoutes = new Set([
      'market',
      'mkt',
      'tracker',
      'inventory',
      'my',
      'terms',
      'login',
      'register',
      'search',
      'article',
      'upgrade',
      'case',
      'ranking',
      'statistics',
    ]);

    return reservedRoutes.has(slug) ? 'other' : 'item-detail';
  } catch {
    return 'other';
  }
}
