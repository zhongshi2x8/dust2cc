// ============================================================
// ECharts Hook — intercept chart setOption to grab K-line data
// ============================================================

const EVENT_NAME = 'cs2-ai-data-captured';

/**
 * Attempt to hook into ECharts instances on the page.
 * csqaq.com uses ECharts for K-line rendering.
 * By intercepting setOption(), we can grab the raw OHLCV data
 * even if we can't match the API request URL.
 */
export function installEChartsHook() {
  // ECharts might load asynchronously, so we poll
  const maxAttempts = 30;
  let attempts = 0;

  const interval = setInterval(() => {
    attempts++;
    const echarts = (window as unknown as Record<string, unknown>).echarts;

    if (echarts && typeof echarts === 'object' && 'init' in echarts) {
      clearInterval(interval);
      patchEChartsInit(echarts as EChartsLike);
      captureExistingCharts(echarts as EChartsLike);
      scheduleExistingChartCapture(echarts as EChartsLike);
      console.log('[CS2 AI Analyst] ECharts hook installed');
    } else if (attempts >= maxAttempts) {
      clearInterval(interval);
      console.log('[CS2 AI Analyst] ECharts not found, skipping hook');
    }
  }, 1000);
}

interface EChartsLike {
  init: (...args: unknown[]) => EChartsInstance;
  getInstanceByDom?: (dom: Element) => EChartsInstance | undefined;
}

interface EChartsInstance {
  setOption: (option: Record<string, unknown>, ...rest: unknown[]) => void;
  getOption: () => Record<string, unknown>;
}

function patchEChartsInit(echarts: EChartsLike) {
  const origInit = echarts.init;

  echarts.init = function (...args: unknown[]) {
    const instance = origInit.apply(this, args) as EChartsInstance;

    const origSetOption = instance.setOption.bind(instance);
    instance.setOption = function (option: Record<string, unknown>, ...rest: unknown[]) {
      // Try to extract candlestick data from the chart options
      extractChartData(option);
      return origSetOption(option, ...rest);
    };

    // Newly created charts should also be inspected once after mount.
    queueMicrotask(() => {
      try {
        extractChartData(instance.getOption());
      } catch {
        // Ignore single-chart failures
      }
    });

    return instance;
  };
}

function scheduleExistingChartCapture(echarts: EChartsLike) {
  let attempts = 0;
  const timer = setInterval(() => {
    attempts++;
    captureExistingCharts(echarts);
    if (attempts >= 10) {
      clearInterval(timer);
    }
  }, 1200);
}

function captureExistingCharts(echarts: EChartsLike) {
  if (typeof echarts.getInstanceByDom !== 'function') return;

  const elements = Array.from(
    document.querySelectorAll('[_echarts_instance_], canvas'),
  );

  for (const element of elements) {
    try {
      const host =
        element instanceof HTMLCanvasElement
          ? (element.parentElement ?? element)
          : element;
      const instance =
        echarts.getInstanceByDom(host) ||
        (host.parentElement ? echarts.getInstanceByDom(host.parentElement) : undefined);

      if (!instance) continue;
      extractChartData(instance.getOption());
    } catch {
      // Ignore per-instance failures
    }
  }
}

function extractChartData(option: Record<string, unknown>) {
  try {
    const series = option.series as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(series)) return;

    const candlestick = series.find(
      (s) => s.type === 'candlestick' || s.type === 'k',
    );
    if (!candlestick) return;

    const xAxis = option.xAxis as Array<Record<string, unknown>> | undefined;
    const dates = Array.isArray(xAxis) ? xAxis[0]?.data : undefined;

    const volumeSeries = series.find(
      (s) => s.type === 'bar' && s.name?.toString().toLowerCase().includes('vol'),
    );

    window.dispatchEvent(
      new CustomEvent(EVENT_NAME, {
        detail: {
          type: 'echarts_kline',
          data: {
            dates,
            ohlc: candlestick.data,
            volumes: volumeSeries?.data,
          },
        },
      }),
    );

    console.log('[CS2 AI Analyst] Captured K-line data from ECharts');
  } catch {
    // Silently fail
  }
}
