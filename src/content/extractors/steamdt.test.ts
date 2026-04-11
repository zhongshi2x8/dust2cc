// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://steamdt.com/cs2/AK-47%20%7C%20Redline%20(Field-Tested)"}

import { beforeEach, describe, expect, it } from 'vitest';
import { getSteamdtPageKind, isSteamdtDetailUrl, normalizeSteamdtTrendResponse, steamdtExtractor } from './steamdt';

declare global {
  interface Window {
    __NUXT__?: Record<string, unknown>;
  }
}

describe('steamdtExtractor.extractPrice', () => {
  function mockRect(
    element: Element | null,
    rect: Partial<DOMRect> & Pick<DOMRect, 'width' | 'height'>,
  ) {
    if (!element) return;
    Object.defineProperty(element, 'getBoundingClientRect', {
      value: () => ({
        x: rect.left ?? 0,
        y: rect.top ?? 0,
        top: rect.top ?? 0,
        left: rect.left ?? 0,
        right: (rect.left ?? 0) + rect.width,
        bottom: (rect.top ?? 0) + rect.height,
        width: rect.width,
        height: rect.height,
        toJSON: () => ({}),
      }),
      configurable: true,
    });
  }

  beforeEach(() => {
    window.history.replaceState({}, '', 'https://steamdt.com/cs2/AK-47%20%7C%20Redline%20(Field-Tested)');
    document.body.innerHTML = '';
    document.title = 'AK-47 | Redline (Field-Tested) - SteamDT';
    window.__NUXT__ = undefined;
  });

  it('reads current price from Nuxt hydration data when DOM selectors do not expose it', () => {
    document.body.innerHTML = `
      <div class="detail-header">
        <h1>AK-47 | Redline (Field-Tested)</h1>
      </div>
      <div class="some-other-block">当前价已由客户端渲染</div>
    `;

    window.__NUXT__ = {
      state: {
        product: {
          detail: {
            itemInfo: {
              sellMinPrice: '34999',
            },
          },
        },
      },
    };

    expect(steamdtExtractor.extractPrice()).toEqual({
      current: 34999,
      currency: 'CNY',
      changePercent24h: undefined,
    });
  });

  it('reads the market index price from __NUXT_DATA__ on steamdt section pages', () => {
    window.history.replaceState({}, '', 'https://steamdt.com/section?type=BROAD');
    document.title = 'CS2饰品板块指数-CS2饰品大盘-CS2板块大盘-SteamDT';
    document.body.innerHTML = `
      <script id="__NUXT_DATA__" type="application/json">
        [{"data":{"record":{"name":"大盘","type":"BROAD","index":1073.2,"yesterdayIndex":1073.27,"riseFallRate":-0.01}}}]
      </script>
    `;

    expect(steamdtExtractor.extractPrice()).toEqual({
      current: 1073.2,
      currency: 'CNY',
      changePercent24h: -0.01,
    });
    expect(steamdtExtractor.extractGoodsInfo()).toEqual({
      id: 'steamdt-market-index-BROAD',
      name: 'SteamDT 大盘指数',
      source: 'steamdt',
    });
  });

  it('finds a hero-area anchor for the inline panel', () => {
    document.body.innerHTML = `
      <main>
        <section class="detail-summary">
          <div class="left-column">
            <h1>AWP | 复古流行</h1>
            <div class="price-main">¥459</div>
          </div>
          <div class="right-column">概况</div>
        </section>
      </main>
    `;

    mockRect(document.querySelector('.detail-summary'), { top: 80, left: 120, width: 980, height: 220 });
    mockRect(document.querySelector('h1'), { top: 110, left: 160, width: 360, height: 32 });
    mockRect(document.querySelector('.price-main'), { top: 160, left: 160, width: 180, height: 48 });

    expect(steamdtExtractor.getPanelAnchor?.()?.className).toContain('detail-summary');
  });

  it('prefers the main hero price over lower secondary price cards', () => {
    document.body.innerHTML = `
      <main>
        <section class="detail-summary">
          <div class="left-column">
            <h1>AWP | 复古流行</h1>
            <div class="price-main" style="font-size: 42px;">¥459</div>
          </div>
        </section>
        <section class="trend-side-list">
          <div class="daily-card">今日 <span class="price-chip">¥23 (+5.28%)</span></div>
        </section>
      </main>
    `;

    mockRect(document.querySelector('.detail-summary'), { top: 70, left: 100, width: 940, height: 180 });
    mockRect(document.querySelector('h1'), { top: 95, left: 140, width: 320, height: 28 });
    mockRect(document.querySelector('.price-main'), { top: 145, left: 140, width: 180, height: 54 });
    mockRect(document.querySelector('.price-chip'), { top: 390, left: 1120, width: 110, height: 26 });

    expect(steamdtExtractor.extractPrice()).toEqual({
      current: 459,
      currency: 'CNY',
      changePercent24h: undefined,
    });
  });

  it('keeps the visible hero price when hydration only exposes a far lower lowestPrice', () => {
    document.body.innerHTML = `
      <main>
        <section class="detail-summary">
          <div class="left-column">
            <h1>AK-47 | 红线 (久经沙场)</h1>
            <div class="price-main" style="font-size: 42px;">¥1280</div>
          </div>
        </section>
        <script id="__NUXT_DATA__" type="application/json">
          [{"data":{"detail":{"itemId":"22499","marketHashName":"AK-47 | Redline (Field-Tested)","name":"AK-47 | 红线 (久经沙场)","lowestPrice":226,"diff1Day":-1.27}}}]
        </script>
      </main>
    `;

    mockRect(document.querySelector('.detail-summary'), { top: 70, left: 100, width: 940, height: 180 });
    mockRect(document.querySelector('h1'), { top: 95, left: 140, width: 320, height: 28 });
    mockRect(document.querySelector('.price-main'), { top: 145, left: 140, width: 180, height: 54 });

    expect(steamdtExtractor.extractPrice()).toEqual({
      current: 1280,
      currency: 'CNY',
      changePercent24h: -1.27,
    });
  });

  it('prefers currentPrice over lowestPrice from hydration when both exist', () => {
    document.body.innerHTML = `
      <div class="detail-header">
        <h1>AK-47 | 红线 (久经沙场)</h1>
      </div>
      <script id="__NUXT_DATA__" type="application/json">
        [{"data":{"detail":{"itemId":"22499","marketHashName":"AK-47 | Redline (Field-Tested)","name":"AK-47 | 红线 (久经沙场)","currentPrice":1280,"lowestPrice":226,"sellMinPrice":1278,"diff1Day":-1.27}}}]
      </script>
    `;

    expect(steamdtExtractor.extractPrice()).toEqual({
      current: 1280,
      currency: 'CNY',
      changePercent24h: -1.27,
    });
  });

  it('prefers the visible active main chart over inactive or sidebar charts', () => {
    document.body.innerHTML = `
      <main class="common-container">
        <section class="detail-summary">
          <h1>AWP | 复古流行</h1>
          <div class="price-main">¥459</div>
        </section>
        <section class="goods-trend-layout">
          <div class="trend-sidebar" style="display:none">
            <div class="mini-history-chart">
              <div class="el-tab-pane">
                <div class="sidebar-chart" _echarts_instance_="2"></div>
              </div>
            </div>
          </div>
          <div class="market-trend-card">
            <div class="el-tabs">
              <div class="el-tabs__header">
                <div class="is-active">日K</div>
              </div>
              <div class="el-tab-pane is-active">
                <div class="main-kline-chart" _echarts_instance_="1"></div>
              </div>
            </div>
          </div>
        </section>
      </main>
    `;

    mockRect(document.querySelector('.market-trend-card'), { top: 340, left: 100, width: 1040, height: 520 });
    mockRect(document.querySelector('.main-kline-chart'), { top: 380, left: 140, width: 960, height: 420 });
    mockRect(document.querySelector('.mini-history-chart'), { top: 360, left: 1180, width: 180, height: 120 });
    mockRect(document.querySelector('.sidebar-chart'), { top: 380, left: 1190, width: 160, height: 100 });

    expect(steamdtExtractor.getChartAnchor()?.className).toContain('market-trend-card');
  });

  it('normalizes steamdt tuple-based trend arrays into synthetic OHLC points', () => {
    const points = normalizeSteamdtTrendResponse({
      data: [
        [1775747860, 463.2, 10, 460.5, 4, 12000, 6],
        [1775834260, 464.8, 12, 462.1, 5, 15000, 8],
      ],
    });

    expect(points).toHaveLength(2);
    expect(points[0].close).toBe(463.2);
    expect(points[1].open).toBe(463.2);
    expect(points[1].close).toBe(464.8);
    expect(points[1].volume).toBe(8);
  });

  it('normalizes steamdt kline OHLC tuples without collapsing them into price trends', () => {
    const points = normalizeSteamdtTrendResponse({
      data: [
        [1775747860, 463.2, 464.8, 470.1, 460.5, 12000, 5300000],
        [1775834260, 464.8, 462.9, 468.3, 461.7, 9000, 4100000],
      ],
    });

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

  it('normalizes object-based sellPrice trend records from steamdt fallback payloads', () => {
    const points = normalizeSteamdtTrendResponse({
      data: {
        trendList: [
          { endTime: 1775747860, sellPrice: 463.2, sellCount: 10, biddingPrice: 460.5, biddingCount: 4, transactionCount: 6 },
          { endTime: 1775834260, sellPrice: 464.8, sellCount: 12, biddingPrice: 462.1, biddingCount: 5, transactionCount: 8 },
        ],
      },
    });

    expect(points).toHaveLength(2);
    expect(points[0].close).toBe(463.2);
    expect(points[1].open).toBe(463.2);
    expect(points[1].close).toBe(464.8);
    expect(points[1].volume).toBe(8);
  });

  it('classifies steamdt item and index pages correctly', () => {
    expect(isSteamdtDetailUrl('https://steamdt.com/cs2/AK-47%20%7C%20Redline%20(Field-Tested)')).toBe(true);
    expect(getSteamdtPageKind('https://steamdt.com/', 'SteamDT-CS饰品价格走势_CS2市场大盘_饰品指数')).toBe('market-index');
    expect(getSteamdtPageKind('https://steamdt.com/section?type=BROAD', 'CS2饰品板块指数-CS2饰品大盘')).toBe('market-index');
    expect(getSteamdtPageKind('https://steamdt.com/cs2/market')).toBe('other');
    expect(getSteamdtPageKind('https://steamdt.com/cs2/tracker')).toBe('other');
  });
});
