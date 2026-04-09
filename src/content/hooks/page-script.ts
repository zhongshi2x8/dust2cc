// ============================================================
// Page Script — self-contained hook bundle injected into page
// ============================================================

const EVENT_NAME = 'cs2-ai-data-captured';
const ANNOTATION_EVENT_NAME = 'cs2-ai-annotate-chart';

const chartInstances = new Set<EChartsInstance>();
let latestChartAnnotation: { goodsName: string; lastPrice: number; points: AnnotationPoint[]; indicators?: { ma5?: number[]; ma10?: number[]; ma20?: number[] } } | null = null;
const DOM_OVERLAY_ID = 'cs2-ai-page-annotation-overlay';
let overlayListenersInstalled = false;

type CapturedPayload =
  | { type: 'kline' | 'goods_detail' | 'listings'; data: unknown }
  | { type: 'echarts_kline'; data: EChartsKlineData };

interface EChartsKlineData {
  dates?: unknown[];
  ohlc?: unknown[];
  volumes?: unknown[];
  chartMeta?: ChartMeta;
}

interface ChartMeta {
  xAxisIndex?: number;
  yAxisIndex?: number;
  gridTop?: number | string;
  gridBottom?: number | string;
  gridLeft?: number | string;
  gridRight?: number | string;
  yMin?: number | string;
  yMax?: number | string;
  chartScore?: number;
  seriesLength?: number;
  periodHint?: string;
  isVisible?: boolean;
  isActive?: boolean;
  sourceText?: string;
}

type EChartsOption = Record<string, unknown>;

interface EChartsInstance {
  setOption: (option: EChartsOption, ...rest: unknown[]) => void;
  getOption: () => EChartsOption;
  convertToPixel: (finder: string | Record<string, unknown>, value: unknown) => number[];
  getModel: () => Record<string, unknown>;
  getDom: () => HTMLElement;
  getWidth: () => number;
  getHeight: () => number;
  on: (eventName: string, handler: (params: unknown) => void) => void;
  __cs2OriginalSetOption?: (option: EChartsOption, ...rest: unknown[]) => void;
  __cs2Patched?: boolean;
}

interface EChartsLike {
  init: (...args: unknown[]) => EChartsInstance;
  getInstanceByDom?: (dom: Element) => EChartsInstance | undefined;
}

interface AnnotationPoint {
  kind: string;
  label: string;
  note: string;
  date?: string;
  value: number;
}

function emit(payload: CapturedPayload) {
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: payload }));
}

function emitDebug(stage: string, detail: string, count?: number) {
  window.dispatchEvent(
    new CustomEvent('cs2-ai-page-debug', {
      detail: { stage, detail, count },
    }),
  );
}

function registerChartInstance(instance: EChartsInstance) {
  if (!instance) return;
  chartInstances.add(instance);
  emitDebug('chart-instance', '已识别图表实例', chartInstances.size);
  applyChartAnnotation(instance);
}

function patchChartInstance(instance: EChartsInstance) {
  if (!instance || instance.__cs2Patched) return;

  const origSetOption = (instance.__cs2OriginalSetOption || instance.setOption.bind(instance));
  instance.__cs2OriginalSetOption = origSetOption;
  instance.__cs2Patched = true;

  instance.setOption = function (option: EChartsOption, ...rest: unknown[]) {
    extractChartData(option, instance);
    const result = origSetOption(option, ...rest);
    queueMicrotask(() => {
      applyChartAnnotation(instance);
    });
    return result;
  };
}

function matchesKline(url: string): boolean {
  return (
    /api\/v1\/info\/chart|api\/v1\/info\/simple\/chartAll|api\/v1\/sub\/kline|kline|chart|trend|history/i.test(
      url,
    ) || /api\.steamdt\.com.*(?:trend|history|chart|kline|price.*list)/i.test(url)
  );
}

function matchesGoodsDetail(url: string): boolean {
  return (
    /api\/v1\/info\/good(\?|\/|$)|goods\/detail|item\/info|goods\/info/i.test(url) ||
    /api\.steamdt\.com.*(?:detail|info|item)/i.test(url)
  );
}

function matchesListings(url: string): boolean {
  return (
    /api\/v1\/info\/good\/statistic|listing|sell_order|on_sale/i.test(url) ||
    /api\.steamdt\.com.*(?:selling|listing|on.?sale)/i.test(url)
  );
}

async function tryCaptureFetch(url: string, response: Response) {
  try {
    if (matchesKline(url)) {
      emit({ type: 'kline', data: await response.json() });
    } else if (matchesGoodsDetail(url)) {
      emit({ type: 'goods_detail', data: await response.json() });
    } else if (matchesListings(url)) {
      emit({ type: 'listings', data: await response.json() });
    }
  } catch {
    // Ignore host-page payload parse failures.
  }
}

function tryCaptureXHR(url: string, responseText: string) {
  try {
    if (matchesKline(url)) {
      emit({ type: 'kline', data: JSON.parse(responseText) });
    } else if (matchesGoodsDetail(url)) {
      emit({ type: 'goods_detail', data: JSON.parse(responseText) });
    } else if (matchesListings(url)) {
      emit({ type: 'listings', data: JSON.parse(responseText) });
    }
  } catch {
    // Ignore host-page payload parse failures.
  }
}

function installInterceptors() {
  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const response = await originalFetch.apply(this, args);
    const url = typeof args[0] === 'string' ? args[0] : (args[0] as Request).url;
    void tryCaptureFetch(url, response.clone());
    return response;
  };

  const OrigXHR = window.XMLHttpRequest;
  const origOpen = OrigXHR.prototype.open;
  OrigXHR.prototype.open = function (
    method: string,
    url: string | URL,
    async?: boolean,
    username?: string | null,
    password?: string | null,
  ) {
    (this as XMLHttpRequest & { _cs2Url?: string })._cs2Url = url.toString();
    return origOpen.call(this, method, url, async ?? true, username ?? undefined, password ?? undefined);
  };

  const origSend = OrigXHR.prototype.send;
  OrigXHR.prototype.send = function (body?: Document | XMLHttpRequestBodyInit | null) {
    this.addEventListener('load', function () {
      const url = (this as XMLHttpRequest & { _cs2Url?: string })._cs2Url || '';
      tryCaptureXHR(url, this.responseText);
    });
    return origSend.call(this, body);
  };
}

function getSeriesList(option: EChartsOption): Array<Record<string, unknown>> {
  if (!option || !option.series) return [];
  return Array.isArray(option.series) ? (option.series as Array<Record<string, unknown>>) : [option.series as Record<string, unknown>];
}

function getSeriesDataList(series: Record<string, unknown> | undefined): unknown[] {
  if (!series) return [];
  return Array.isArray(series.data) ? series.data : [];
}

function getNumericTupleLength(item: unknown): number {
  if (Array.isArray(item)) {
    const numericValues = item.filter((value) => typeof value === 'number' && Number.isFinite(value));
    return numericValues.length;
  }

  if (item && typeof item === 'object' && Array.isArray((item as Record<string, unknown>).value)) {
    const numericValues = ((item as Record<string, unknown>).value as unknown[])
      .filter((value) => typeof value === 'number' && Number.isFinite(value));
    return numericValues.length;
  }

  return 0;
}

function normalizeOhlcEntry(item: unknown): unknown[] | null {
  if (Array.isArray(item)) return item;
  if (item && typeof item === 'object' && Array.isArray((item as Record<string, unknown>).value)) {
    return (item as Record<string, unknown>).value as unknown[];
  }
  return null;
}

function findCandlestickLikeSeries(series: Array<Record<string, unknown>>): Record<string, unknown> | undefined {
  const directMatch = series.find((item) => item.type === 'candlestick' || item.type === 'k');
  if (directMatch) return directMatch;

  return series.find((item) => {
    const type = String(item.type || '').toLowerCase();
    if (type === 'bar') return false;
    const data = getSeriesDataList(item);
    if (!data.length) return false;

    const sample = data.slice(0, 6);
    const richTupleCount = sample.filter((entry) => getNumericTupleLength(entry) >= 4).length;
    return richTupleCount >= Math.max(1, Math.ceil(sample.length / 2));
  });
}

function inferDatesFromSeriesData(data: unknown[]): unknown[] | undefined {
  const dates = data
    .map((item) => {
      if (item && typeof item === 'object') {
        const record = item as Record<string, unknown>;
        return record.name || record.date || record.time || record.timestamp;
      }
      return undefined;
    })
    .filter((value) => value !== undefined);

  return dates.length ? dates : undefined;
}

function resolveChartContextRoot(dom: HTMLElement | null): HTMLElement | null {
  if (!dom) return null;

  return (
    dom.closest<HTMLElement>('[class*="trend"]') ||
    dom.closest<HTMLElement>('[class*="chart"]') ||
    dom.closest<HTMLElement>('[class*="kline"]') ||
    dom.closest<HTMLElement>('.el-tabs') ||
    dom.parentElement ||
    dom
  );
}

function isElementVisible(element: HTMLElement | null): boolean {
  if (!element) return false;

  const style = window.getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
    return false;
  }
  if (element.hidden || element.getAttribute('aria-hidden') === 'true') {
    return false;
  }

  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function isElementActive(element: HTMLElement | null): boolean {
  if (!element) return false;
  if (element.closest('[hidden], [aria-hidden="true"], .is-hidden')) return false;

  const tabPane = element.closest<HTMLElement>('.el-tab-pane');
  if (tabPane) {
    if (tabPane.classList.contains('is-active') || tabPane.classList.contains('active')) return true;
    const style = window.getComputedStyle(tabPane);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
  }

  return true;
}

function collectChartContextText(element: HTMLElement | null): string {
  if (!element) return '';

  const activeTabText =
    element.closest('.el-tabs')?.querySelector('.is-active, .active, [aria-selected="true"]')?.textContent || '';
  const nearby = [
    element.textContent || '',
    element.parentElement?.textContent || '',
    element.previousElementSibling?.textContent || '',
    element.nextElementSibling?.textContent || '',
    activeTabText,
  ];

  return nearby.join(' ').replace(/\s+/g, ' ').slice(0, 320);
}

function inferChartPeriodHint(contextText: string): string {
  const text = contextText.toLowerCase();
  if (/日k|日线|daily|1d/.test(text)) return '1d';
  if (/周k|周线|weekly|1w/.test(text)) return '1w';
  if (/月k|月线|monthly|1m/.test(text)) return '1m';
  return 'unknown';
}

function scoreChartCandidate(
  dom: HTMLElement | null,
  candlestick: Record<string, unknown>,
): { score: number; contextText: string; visible: boolean; active: boolean; periodHint: string } {
  const root = resolveChartContextRoot(dom);
  const visible = isElementVisible(root ?? dom);
  const active = isElementActive(root ?? dom);
  const rect = (root ?? dom)?.getBoundingClientRect();
  const contextText = collectChartContextText(root ?? dom);
  const periodHint = inferChartPeriodHint(contextText);
  const candidateText = `${root?.className || ''} ${root?.id || ''} ${contextText}`.toLowerCase();
  const dataLength = Array.isArray(candlestick.data) ? candlestick.data.length : 0;

  let score = 0;

  if (visible) score += 20;
  else score -= 30;
  if (active) score += 14;
  else score -= 24;
  if (/trend|走势|chart|kline|history/.test(candidateText)) score += 12;
  if (/price|market/.test(candidateText)) score += 5;
  if (/sidebar|related|recommend|wear|磨损|listing|sell|buy|order/.test(candidateText)) score -= 14;
  if (periodHint === '1d') score += 18;
  if (periodHint === '1w') score -= 6;
  if (rect) {
    if (rect.width > 880 && rect.height > 360) score += 18;
    else if (rect.width > 620 && rect.height > 260) score += 10;
    else if (rect.width > 280 && rect.height > 150) score += 4;
    else score -= 8;
  }
  if (dataLength >= 60) score += 10;
  else if (dataLength >= 20) score += 6;
  else if (dataLength >= 5) score += 2;
  else score -= 10;

  return { score, contextText, visible, active, periodHint };
}

function extractChartData(option: EChartsOption, instance?: EChartsInstance) {
  try {
    const series = getSeriesList(option);
    if (!series.length) return;

    const candlestick = findCandlestickLikeSeries(series);
    if (!candlestick) return;

    const xAxisIndex = Number(candlestick.xAxisIndex) || 0;
    const yAxisIndex = Number(candlestick.yAxisIndex) || 0;
    const xAxis = option.xAxis as Array<Record<string, unknown>> | undefined;
    const dates = Array.isArray(xAxis)
      ? xAxis[xAxisIndex] && xAxis[xAxisIndex].data
      : inferDatesFromSeriesData(getSeriesDataList(candlestick));
    const yAxis = Array.isArray(option.yAxis) ? option.yAxis[yAxisIndex] : option.yAxis;
    const grid = Array.isArray(option.grid) ? option.grid[0] : option.grid;
    const volumeSeries = series.find(
      (item) => item.type === 'bar' && item.name?.toString().toLowerCase().includes('vol'),
    );
    const chartAssessment = scoreChartCandidate(instance?.getDom() ?? null, candlestick);
    const ohlcData = getSeriesDataList(candlestick)
      .map((item) => normalizeOhlcEntry(item))
      .filter((item): item is unknown[] => Array.isArray(item) && item.length >= 4);
    if (!ohlcData.length) return;

    emit({
      type: 'echarts_kline',
      data: {
        dates: dates as unknown[] | undefined,
        ohlc: ohlcData,
        volumes: volumeSeries && (volumeSeries.data as unknown[] | undefined),
        chartMeta: {
          xAxisIndex,
          yAxisIndex,
          gridTop: grid && (grid as Record<string, unknown>).top,
          gridBottom: grid && (grid as Record<string, unknown>).bottom,
          gridLeft: grid && (grid as Record<string, unknown>).left,
          gridRight: grid && (grid as Record<string, unknown>).right,
          yMin: yAxis && (yAxis as Record<string, unknown>).min,
          yMax: yAxis && (yAxis as Record<string, unknown>).max,
          chartScore: chartAssessment.score,
          seriesLength: ohlcData.length,
          periodHint: chartAssessment.periodHint,
          isVisible: chartAssessment.visible,
          isActive: chartAssessment.active,
          sourceText: chartAssessment.contextText,
        },
      },
    });
  } catch {
    // Ignore single chart failures.
  }
}

function captureExistingCharts(echarts: EChartsLike) {
  if (typeof echarts.getInstanceByDom !== 'function') return;

  const elements = Array.from(document.querySelectorAll('[_echarts_instance_], canvas'));
  for (const element of elements) {
    try {
      const host =
        element instanceof HTMLCanvasElement ? (element.parentElement ?? element) : element;
      const instance =
        echarts.getInstanceByDom(host) ||
        (host.parentElement ? echarts.getInstanceByDom(host.parentElement) : undefined);
      if (!instance) continue;
      patchChartInstance(instance);
      registerChartInstance(instance);
      extractChartData(instance.getOption(), instance);
    } catch {
      // Ignore per-instance failures.
    }
  }
}

function findCandlestickSeriesIndex(option: EChartsOption): number {
  const series = getSeriesList(option);
  return series.findIndex((item) => item && (item.type === 'candlestick' || item.type === 'k'));
}

function findCategoryIndex(axisData: unknown[], targetDate?: string): number {
  if (!Array.isArray(axisData) || !axisData.length || !targetDate) return -1;

  const exactIndex = axisData.findIndex((item) => String(item) === String(targetDate));
  if (exactIndex >= 0) return exactIndex;

  return axisData.findIndex(
    (item) => String(item).includes(String(targetDate)) || String(targetDate).includes(String(item)),
  );
}

function getAnnotationColor(kind: string): string {
  if (kind === 'buy_zone') return '#4CAF50';
  if (kind === 'stop_loss') return '#FF5252';
  if (kind === 'breakout') return '#29B6F6';
  if (kind === 'target') return '#CE93D8';
  if (kind === 'support') return '#66BB6A';
  if (kind === 'resistance') return '#FF8A65';
  if (kind === 'ma20') return '#FFD54F';
  if (kind === 'high') return '#64B5F6';
  if (kind === 'low') return '#BA68C8';
  return '#7C8CFF';
}

function buildMarkPointData(point: AnnotationPoint, axisData: unknown[]) {
  if (!point || !Number.isFinite(point.value)) return null;

  const categoryIndex = point.date ? findCategoryIndex(axisData, point.date) : axisData.length - 1;
  if (categoryIndex < 0 || !axisData.length) return null;
  const xValue = axisData[Math.max(0, categoryIndex)];

  const symbolMap: Record<string, string> = {
    latest: 'pin',
    buy_zone: 'triangle',
    stop_loss: 'diamond',
    breakout: 'arrow',
    target: 'pin',
    high: 'circle',
    low: 'circle',
  };
  const sizeMap: Record<string, number> = {
    latest: 48,
    buy_zone: 44,
    stop_loss: 40,
    breakout: 44,
    target: 44,
  };

  return {
    name: point.label,
    value: Number(point.value.toFixed(2)),
    coord: [xValue, point.value],
    note: point.note || point.label,
    advice: (point as AnnotationPoint & { advice?: string }).advice || point.note || '',
    symbol: symbolMap[point.kind] || 'circle',
    symbolSize: sizeMap[point.kind] || 36,
    itemStyle: {
      color: getAnnotationColor(point.kind),
      borderColor: '#fff',
      borderWidth: 2,
      shadowBlur: 20,
      shadowColor: getAnnotationColor(point.kind),
    },
    emphasis: {
      scale: true,
      itemStyle: {
        shadowBlur: 32,
        borderWidth: 3,
      },
    },
    label: {
      show: true,
      position: 'top' as const,
      distance: 6,
      color: '#fff',
      fontSize: 11,
      fontWeight: 'bold',
      backgroundColor: 'rgba(10, 14, 26, 0.88)',
      borderColor: getAnnotationColor(point.kind),
      borderWidth: 1,
      borderRadius: 4,
      padding: [4, 8],
      formatter(params: { data: { name: string } }) {
        return `${params.data.name}`;
      },
    },
  };
}

function buildMarkLineData(point: AnnotationPoint) {
  if (!point || !Number.isFinite(point.value)) return null;

  const dashedKinds = new Set(['ma20', 'target', 'breakout']);
  const thinKinds = new Set(['ma20', 'support', 'resistance']);

  return {
    name: point.label,
    yAxis: Number(point.value.toFixed(2)),
    note: point.note || point.label,
    lineStyle: {
      color: getAnnotationColor(point.kind),
      type: dashedKinds.has(point.kind) ? 'dashed' : point.kind === 'stop_loss' ? 'dotted' : 'solid',
      width: thinKinds.has(point.kind) ? 1.5 : 2,
      opacity: 0.92,
    },
    label: {
      show: true,
      position: 'insideEndTop' as const,
      color: getAnnotationColor(point.kind),
      backgroundColor: 'rgba(10, 14, 26, 0.88)',
      borderRadius: 4,
      padding: [4, 6],
      formatter(params: { data: { name: string } }) {
        return `${params.data.name}`;
      },
    },
  };
}

function alignIndicatorData(axisData: unknown[], data: number[]): (number | null)[] {
  if (!Array.isArray(data) || data.length === 0) return [];
  if (data.length === axisData.length) {
    return data.map((v) => (Number.isFinite(v) ? v : null));
  }
  const result = new Array(axisData.length).fill(null);
  const startIdx = axisData.length - data.length;
  for (let i = 0; i < data.length; i++) {
    const idx = startIdx + i;
    if (idx >= 0 && Number.isFinite(data[i])) {
      result[idx] = data[i];
    }
  }
  return result;
}

function buildIndicatorSeries(
  axisData: unknown[],
  indicators: { ma5?: number[]; ma10?: number[]; ma20?: number[] } | undefined,
  xAxisIndex: number,
  yAxisIndex: number,
) {
  if (!indicators) return [];
  const configs = [
    { key: 'ma5' as const, name: 'MA5', color: '#FFD700' },
    { key: 'ma10' as const, name: 'MA10', color: '#FF6B6B' },
    { key: 'ma20' as const, name: 'MA20', color: '#4ECDC4' },
  ];
  const seriesList: Array<Record<string, unknown>> = [];
  for (const cfg of configs) {
    const raw = indicators[cfg.key];
    if (!Array.isArray(raw) || raw.length === 0) continue;
    const aligned = alignIndicatorData(axisData, raw);
    seriesList.push({
      id: `cs2-ai-${cfg.key}`,
      name: cfg.name,
      type: 'line',
      xAxisIndex,
      yAxisIndex,
      data: aligned,
      symbol: 'none',
      smooth: false,
      lineStyle: { color: cfg.color, width: 2.5 },
      z: 90,
      animation: false,
    });
  }
  return seriesList;
}

function buildAnnotationOption(option: EChartsOption, annotation: typeof latestChartAnnotation) {
  if (!annotation || !Array.isArray(annotation.points) || annotation.points.length === 0) {
    emitDebug('build-annotation', 'annotation 为空或没有点位');
    return null;
  }

  const candlestickSeriesIndex = findCandlestickSeriesIndex(option);
  if (candlestickSeriesIndex < 0) {
    emitDebug('build-annotation', '未找到蜡烛图 series');
    return null;
  }

  const series = getSeriesList(option);
  const candlestickSeries = series[candlestickSeriesIndex];
  const xAxisIndex = Number(candlestickSeries && candlestickSeries.xAxisIndex) || 0;
  const yAxisIndex = Number(candlestickSeries && candlestickSeries.yAxisIndex) || 0;
  const axisData = Array.isArray(option.xAxis)
    ? (option.xAxis as Array<Record<string, unknown>>)[xAxisIndex] &&
      Array.isArray((option.xAxis as Array<Record<string, unknown>>)[xAxisIndex].data)
      ? (option.xAxis as Array<Record<string, unknown>>)[xAxisIndex].data
      : []
    : Array.isArray(option.xAxis && (option.xAxis as Record<string, unknown>).data)
      ? (option.xAxis as Record<string, unknown>).data
      : [];

  // Points with date → markPoint on specific candle; horizontal levels → markLine
  const markPointKinds = new Set(['latest', 'high', 'low', 'buy_zone', 'target']);
  const markLineKinds = new Set(['latest', 'support', 'resistance', 'ma20', 'buy_zone', 'stop_loss', 'breakout', 'target']);

  const markPoints = annotation.points
    .filter((point) => markPointKinds.has(point.kind))
    .map((point) => buildMarkPointData(point, axisData as unknown[]))
    .filter(Boolean);

  const markLines = annotation.points
    .filter((point) => markLineKinds.has(point.kind))
    .map((point) => buildMarkLineData(point))
    .filter(Boolean);

  const seriesPatch = series.map(() => ({}));
  seriesPatch[candlestickSeriesIndex] = {
    xAxisIndex,
    yAxisIndex,
    markPoint: markPoints.length
      ? {
          symbolKeepAspect: true,
          animation: false,
          z: 120,
          data: markPoints,
        }
      : undefined,
    markLine: markLines.length
      ? {
          silent: true,
          animation: false,
          symbol: ['none', 'none'],
          z: 110,
          data: markLines,
        }
      : undefined,
  };

  const indicatorSeries = buildIndicatorSeries(axisData as unknown[], annotation.indicators, xAxisIndex, yAxisIndex);
  const existingIds = new Set(series.map((s) => s.id).filter(Boolean) as string[]);
  for (const s of indicatorSeries) {
    if (existingIds.has(s.id as string)) {
      const idx = series.findIndex((os) => os.id === s.id);
      if (idx >= 0) seriesPatch[idx] = s;
    } else {
      seriesPatch.push(s);
    }
  }

  emitDebug('build-annotation', `生成标注 option，markLine=${markLines.length}, markPoint=${markPoints.length}, indicators=${indicatorSeries.length}`);
  return { series: seriesPatch };
}

function findAnnotationContext(instance: EChartsInstance, annotation: typeof latestChartAnnotation) {
  if (!instance || !annotation) return null;

  const option = instance.getOption();
  const seriesIndex = findCandlestickSeriesIndex(option);
  if (seriesIndex < 0) return null;

  const series = getSeriesList(option);
  const candlestickSeries = series[seriesIndex];
  const xAxisIndex = Number(candlestickSeries && candlestickSeries.xAxisIndex) || 0;
  const yAxisIndex = Number(candlestickSeries && candlestickSeries.yAxisIndex) || 0;
  const axisData = Array.isArray(option.xAxis)
    ? (option.xAxis as Array<Record<string, unknown>>)[xAxisIndex] &&
      Array.isArray((option.xAxis as Array<Record<string, unknown>>)[xAxisIndex].data)
      ? (option.xAxis as Array<Record<string, unknown>>)[xAxisIndex].data
      : []
    : Array.isArray(option.xAxis && (option.xAxis as Record<string, unknown>).data)
      ? (option.xAxis as Record<string, unknown>).data
      : [];

  return { option, seriesIndex, xAxisIndex, yAxisIndex, axisData: axisData as unknown[] };
}

function getOverlayShortLabel(kind: string): string {
  if (kind === 'buy_zone') return '买入';
  if (kind === 'stop_loss') return '止损';
  if (kind === 'breakout') return '追高';
  if (kind === 'target') return '目标';
  if (kind === 'support') return '支撑';
  if (kind === 'resistance') return '阻力';
  if (kind === 'ma20') return 'MA20';
  if (kind === 'high') return '高点';
  if (kind === 'low') return '低点';
  return '现价';
}

function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getOrCreateDomOverlay(): HTMLElement {
  const existing = document.getElementById(DOM_OVERLAY_ID);
  if (existing) return existing;

  const overlay = document.createElement('div');
  overlay.id = DOM_OVERLAY_ID;
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 0;
    height: 0;
    pointer-events: none;
    z-index: 2147483640;
    overflow: hidden;
  `;
  overlay.innerHTML = `
    <style>
      #${DOM_OVERLAY_ID} .legend {
        position: absolute;
        top: 0;
        right: 0;
        display: flex;
        flex-direction: column;
        gap: 4px;
        width: min(34%, 260px);
        padding: 8px 10px;
        border-radius: 12px;
        background: rgba(10, 14, 26, 0.78);
        border: 1px solid rgba(255, 255, 255, 0.12);
        box-shadow: 0 10px 26px rgba(0, 0, 0, 0.18);
        backdrop-filter: blur(6px);
      }
      #${DOM_OVERLAY_ID} .legend-item {
        display: flex;
        align-items: flex-start;
        gap: 6px;
      }
      #${DOM_OVERLAY_ID} .legend-dot {
        width: 8px;
        height: 8px;
        margin-top: 4px;
        border-radius: 999px;
        background: var(--line-color);
        flex: 0 0 auto;
      }
      #${DOM_OVERLAY_ID} .legend-text {
        color: rgba(238, 242, 255, 0.88);
        font-size: 10px;
        line-height: 1.35;
      }
      #${DOM_OVERLAY_ID} .line {
        position: absolute;
        left: 0;
        right: 0;
        transform: translateY(-50%);
        min-height: 32px;
      }
      #${DOM_OVERLAY_ID} .kind-tag {
        position: absolute;
        left: 0;
        top: 50%;
        transform: translateY(-50%);
        min-width: 54px;
        padding: 3px 8px;
        border-radius: 999px;
        background: rgba(10, 14, 26, 0.88);
        border: 1px solid var(--line-color);
        box-shadow: 0 8px 18px rgba(0, 0, 0, 0.18);
        color: #fff;
        font-size: 11px;
        font-weight: 700;
        line-height: 1.2;
        text-align: center;
      }
      #${DOM_OVERLAY_ID} .rule {
        position: absolute;
        left: 64px;
        right: 108px;
        top: 50%;
        transform: translateY(-50%);
        height: 3px;
        background: linear-gradient(
          90deg,
          rgba(255, 255, 255, 0.06) 0%,
          var(--line-color) 18%,
          var(--line-color) 82%,
          rgba(255, 255, 255, 0.06) 100%
        );
        box-shadow:
          0 0 0 1px rgba(255, 255, 255, 0.08),
          0 0 12px var(--line-color);
      }
      #${DOM_OVERLAY_ID} .dot {
        position: absolute;
        right: 96px;
        top: 50%;
        transform: translate(50%, -50%);
        width: 12px;
        height: 12px;
        border-radius: 999px;
        background: var(--line-color);
        box-shadow:
          0 0 0 2px rgba(255, 255, 255, 0.88),
          0 0 18px var(--line-color);
      }
      #${DOM_OVERLAY_ID} .price-tag {
        position: absolute;
        right: 0;
        top: 50%;
        transform: translateY(-50%);
        min-width: 92px;
        padding: 4px 8px;
        border-radius: 999px;
        background: rgba(10, 14, 26, 0.88);
        border: 1px solid var(--line-color);
        color: #eef2ff;
        font-size: 11px;
        font-weight: 700;
        line-height: 1.2;
        text-align: center;
      }
      #${DOM_OVERLAY_ID} .marker {
        position: absolute;
        width: 20px;
        height: 20px;
        border-radius: 999px;
        border: 2px solid #fff;
        background: var(--line-color);
        box-shadow:
          0 0 0 2px rgba(255,255,255,0.6),
          0 0 20px 4px var(--line-color);
        transform: translate(-50%, -50%);
        pointer-events: auto;
        cursor: pointer;
        transition: transform 0.15s ease;
        z-index: 10;
      }
      #${DOM_OVERLAY_ID} .marker:hover {
        transform: translate(-50%, -50%) scale(1.25);
      }
      #${DOM_OVERLAY_ID} .marker-label {
        position: absolute;
        top: -26px;
        left: 50%;
        transform: translateX(-50%);
        padding: 2px 8px;
        border-radius: 4px;
        background: rgba(10, 14, 26, 0.95);
        border: 1px solid var(--line-color);
        color: #fff;
        font-size: 10px;
        font-weight: 600;
        white-space: nowrap;
        pointer-events: none;
      }
    </style>
    <div id="${DOM_OVERLAY_ID}-content"></div>
  `;
  document.body.appendChild(overlay);
  return overlay;
}

function renderPreciseAnnotationOverlay(
  instance: EChartsInstance,
  annotation: typeof latestChartAnnotation,
  attempt = 0,
) {
  const context = findAnnotationContext(instance, annotation);
  if (!context) {
    emitDebug('overlay', '未找到可用的蜡烛图上下文');
    return;
  }

  const dom = instance.getDom();
  const rect = dom.getBoundingClientRect();
  if (rect.width < 120 || rect.height < 120) {
    emitDebug('overlay', `图表尺寸过小 ${Math.round(rect.width)}x${Math.round(rect.height)}`);
    return;
  }

  const overlay = getOrCreateDomOverlay();
  const content = overlay.querySelector(`#${DOM_OVERLAY_ID}-content`);
  if (!content) {
    emitDebug('overlay', 'overlay content 节点未找到');
    return;
  }

  // Align overlay with ECharts content box (excluding border) to match convertToPixel coordinate origin
  const top = rect.top + (dom.clientTop || 0);
  const left = rect.left + (dom.clientLeft || 0);
  overlay.style.top = `${Math.max(0, top)}px`;
  overlay.style.left = `${Math.max(0, left)}px`;
  overlay.style.width = `${dom.clientWidth}px`;
  overlay.style.height = `${dom.clientHeight}px`;

  const visiblePoints = (annotation!.points as AnnotationPoint[])
    .filter((point) => point && Number.isFinite(point.value))
    .map((point) => {
      const xIndex = point.date
        ? findCategoryIndex(context.axisData, point.date)
        : Math.max(context.axisData.length - 1, 0);
      const xValue = context.axisData[Math.max(0, xIndex)] ?? xIndex;
      const coord: [number, number] =
        typeof xValue === 'number' ? [xValue, point.value] : [Math.max(0, xIndex), point.value];
      let pixel = instance.convertToPixel(
        { xAxisIndex: context.xAxisIndex, yAxisIndex: context.yAxisIndex },
        coord,
      );
      if (!Array.isArray(pixel) || !Number.isFinite(pixel[1])) {
        pixel = instance.convertToPixel({ seriesIndex: context.seriesIndex }, coord);
      }
      return {
        ...point,
        x: Array.isArray(pixel) ? pixel[0] : null,
        y: Array.isArray(pixel) ? pixel[1] : null,
      };
    })
    .filter((point): point is AnnotationPoint & { x: number; y: number } => Number.isFinite(point.x) && Number.isFinite(point.y))
    .sort((a, b) => a.y - b.y);

  emitDebug('overlay', `已计算图上点位 (attempt=${attempt})`, visiblePoints.length);

  if (visiblePoints.length === 0) {
    if (attempt < 3) {
      setTimeout(() => renderPreciseAnnotationOverlay(instance, annotation, attempt + 1), 80);
    } else {
      emitDebug('overlay', '多次重试后仍无法映射点位，放弃渲染');
    }
    return;
  }

  const legendHtml = visiblePoints
    .slice(0, 5)
    .map(
      (point) => `
      <div class="legend-item">
        <span class="legend-dot" style="--line-color:${getAnnotationColor(point.kind)};"></span>
        <span class="legend-text">${escapeHtml(point.label)}: ${escapeHtml(point.note)}</span>
      </div>
    `,
    )
    .join('');

  const linesHtml = visiblePoints
    .map(
      (point) => `
      <div class="line" style="top:${point.y}px; --line-color:${getAnnotationColor(point.kind)};">
        <div class="kind-tag">${escapeHtml(getOverlayShortLabel(point.kind))}</div>
        <div class="rule"></div>
        <div class="dot"></div>
        <div class="price-tag">${escapeHtml(point.label)}</div>
      </div>
    `,
    )
    .join('');

  const markersHtml = visiblePoints
    .map(
      (point) => `
      <div class="marker" data-label="${escapeHtml(point.label)}" data-advice="${escapeHtml((point as AnnotationPoint & { advice?: string }).advice || point.note || '')}" style="left:${point.x}px;top:${point.y}px;--line-color:${getAnnotationColor(point.kind)};">
        <div class="marker-label">${escapeHtml(getOverlayShortLabel(point.kind))}</div>
      </div>
    `,
    )
    .join('');

  content.innerHTML = `<div class="legend">${legendHtml}</div>${linesHtml}${markersHtml}`;

  const markers = content.querySelectorAll('.marker');
  for (const marker of markers) {
    marker.addEventListener('click', (e) => {
      const label = marker.getAttribute('data-label') || '';
      const advice = marker.getAttribute('data-advice') || '';
      const rect = marker.getBoundingClientRect();
      showChartTooltip(rect.left + rect.width / 2, rect.top + rect.height / 2, label, advice);
      e.stopPropagation();
    });
  }

  emitDebug('overlay', 'DOM 标注已渲染', visiblePoints.length);
}

function bindDomOverlayListeners() {
  if (overlayListenersInstalled) return;
  overlayListenersInstalled = true;

  const rerender = () => {
    const instance = Array.from(chartInstances).at(-1);
    if (instance) {
      renderPreciseAnnotationOverlay(instance, latestChartAnnotation);
    }
  };

  window.addEventListener('scroll', rerender, { passive: true });
  window.addEventListener('resize', rerender);
}

const CHART_TOOLTIP_ID = 'cs2-ai-chart-tooltip';

function getOrCreateChartTooltip(): HTMLElement {
  const existing = document.getElementById(CHART_TOOLTIP_ID);
  if (existing) return existing;
  const tooltip = document.createElement('div');
  tooltip.id = CHART_TOOLTIP_ID;
  tooltip.style.cssText = `
    position: fixed;
    z-index: 2147483646;
    max-width: 280px;
    padding: 10px 12px;
    border-radius: 8px;
    background: rgba(15, 18, 34, 0.98);
    border: 1px solid rgba(255, 255, 255, 0.14);
    color: #e8ecff;
    font-size: 12px;
    line-height: 1.5;
    box-shadow: 0 10px 30px rgba(0,0,0,0.35);
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.15s ease;
  `;
  document.body.appendChild(tooltip);
  return tooltip;
}

function showChartTooltip(x: number, y: number, title: string, content: string) {
  const tooltip = getOrCreateChartTooltip();
  tooltip.innerHTML = `<div style="font-weight:600;margin-bottom:4px;color:#a5b4fc">${escapeHtml(title)}</div><div>${escapeHtml(content)}</div>`;
  tooltip.style.left = `${Math.min(window.innerWidth - 300, Math.max(8, x + 12))}px`;
  tooltip.style.top = `${Math.min(window.innerHeight - 120, Math.max(8, y + 12))}px`;
  tooltip.style.opacity = '1';
  if ((tooltip as HTMLElement & { _hideTimer?: number })._hideTimer) {
    clearTimeout((tooltip as HTMLElement & { _hideTimer?: number })._hideTimer);
  }
  (tooltip as HTMLElement & { _hideTimer?: number })._hideTimer = window.setTimeout(() => {
    tooltip.style.opacity = '0';
  }, 6000);
}

document.addEventListener('click', (e) => {
  const tooltip = document.getElementById(CHART_TOOLTIP_ID);
  if (tooltip && !tooltip.contains(e.target as Node)) {
    tooltip.style.opacity = '0';
  }
});

function applyChartAnnotation(instance: EChartsInstance) {
  if (!instance || !latestChartAnnotation) {
    emitDebug('apply-annotation', `跳过: instance=${!!instance}, annotation=${!!latestChartAnnotation}`);
    return;
  }

  try {
    const option = instance.getOption();
    const annotationOption = buildAnnotationOption(option, latestChartAnnotation);
    if (annotationOption) {
      const originalSetOption =
        instance.__cs2OriginalSetOption || instance.setOption.bind(instance);
      originalSetOption(annotationOption);
      emitDebug('markline', '已尝试写入 ECharts 标注');
    } else {
      emitDebug('markline', '未生成可用的 ECharts 标注');
    }

    if (!(instance as EChartsInstance & { _cs2ClickBound?: boolean })._cs2ClickBound) {
      (instance as EChartsInstance & { _cs2ClickBound?: boolean })._cs2ClickBound = true;
      instance.on('click', function (this: EChartsInstance, params: unknown) {
        const p = params as { componentType?: string; data?: { name?: string; advice?: string }; event?: { clientX?: number; clientY?: number } };
        if (p && p.componentType === 'markPoint' && p.data && p.data.advice) {
          const ev = p.event || {};
          showChartTooltip(ev.clientX ?? 0, ev.clientY ?? 0, p.data.name || '', p.data.advice);
        }
      });
    }

    bindDomOverlayListeners();
    renderPreciseAnnotationOverlay(instance, latestChartAnnotation);
  } catch (e) {
    emitDebug('annotation-error', '标注应用失败: ' + (e instanceof Error ? e.message : String(e)));
    chartInstances.delete(instance);
  }
}

function patchECharts(echarts: EChartsLike) {
  const origInit = echarts.init;
  echarts.init = function (...args: unknown[]) {
    const instance = origInit.apply(this, args) as EChartsInstance;
    patchChartInstance(instance);

    queueMicrotask(() => {
      try {
        extractChartData(instance.getOption(), instance);
        registerChartInstance(instance);
      } catch {
        // Ignore single chart failures.
      }
    });

    return instance;
  };
}

function installEChartsHook() {
  const maxAttempts = 30;
  let attempts = 0;

  const timer = setInterval(() => {
    attempts++;
    const echarts = (window as unknown as Record<string, unknown>).echarts;
    if (echarts && typeof echarts === 'object' && 'init' in echarts) {
      clearInterval(timer);
      patchECharts(echarts as EChartsLike);
      captureExistingCharts(echarts as EChartsLike);

      let replayCount = 0;
      const replayTimer = setInterval(() => {
        replayCount++;
        captureExistingCharts(echarts as EChartsLike);
        if (replayCount >= 10) {
          clearInterval(replayTimer);
        }
      }, 1200);
      return;
    }

    if (attempts >= maxAttempts) {
      clearInterval(timer);
    }
  }, 1000);
}

function installAnnotationListener() {
  window.addEventListener(ANNOTATION_EVENT_NAME, ((event: Event) => {
    const customEvent = event as CustomEvent;
    if (!customEvent.detail) return;
    latestChartAnnotation = customEvent.detail;
    emitDebug(
      'annotation-message',
      '已收到内容脚本点位数据',
      Array.isArray(latestChartAnnotation?.points) ? latestChartAnnotation.points.length : 0,
    );

    for (const instance of chartInstances) {
      applyChartAnnotation(instance);
    }
  }) as EventListener);
}

installInterceptors();
installEChartsHook();
installAnnotationListener();
