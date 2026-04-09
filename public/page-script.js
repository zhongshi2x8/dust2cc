// ============================================================
// Page Script — self-contained hook bundle injected into page
// ============================================================

const EVENT_NAME = 'cs2-ai-data-captured';
const ANNOTATION_EVENT_NAME = 'cs2-ai-annotate-chart';
const chartInstances = new Set();
let latestChartAnnotation = null;
const DOM_OVERLAY_ID = 'cs2-ai-page-annotation-overlay';
let overlayListenersInstalled = false;

function emit(payload) {
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: payload }));
}

function emitDebug(stage, detail, count) {
  window.dispatchEvent(new CustomEvent('cs2-ai-page-debug', {
    detail: { stage, detail, count },
  }));
}

function registerChartInstance(instance) {
  if (!instance) return;
  chartInstances.add(instance);
  emitDebug('chart-instance', '已识别图表实例', chartInstances.size);
  applyChartAnnotation(instance);
}

function matchesKline(url) {
  return /api\/v1\/info\/chart|api\/v1\/info\/simple\/chartAll|api\/v1\/sub\/kline|kline|chart|trend|history/i.test(url);
}

function matchesGoodsDetail(url) {
  return /api\/v1\/info\/good(\?|\/|$)|goods\/detail|item\/info|goods\/info/i.test(url);
}

function matchesListings(url) {
  return /api\/v1\/info\/good\/statistic|listing|sell_order|on_sale/i.test(url);
}

async function tryCaptureFetch(url, response) {
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

function tryCaptureXHR(url, responseText) {
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
    const url = typeof args[0] === 'string' ? args[0] : args[0].url;
    void tryCaptureFetch(url, response.clone());
    return response;
  };

  const OrigXHR = window.XMLHttpRequest;
  const origOpen = OrigXHR.prototype.open;
  OrigXHR.prototype.open = function (method, url, async, username, password) {
    this._cs2Url = url.toString();
    return origOpen.call(this, method, url, async ?? true, username ?? undefined, password ?? undefined);
  };

  const origSend = OrigXHR.prototype.send;
  OrigXHR.prototype.send = function (body) {
    this.addEventListener('load', function () {
      const url = this._cs2Url || '';
      tryCaptureXHR(url, this.responseText);
    });
    return origSend.call(this, body);
  };
}

function extractChartData(option) {
  try {
    const series = option.series;
    if (!Array.isArray(series)) return;

    const candlestick = series.find((item) => item.type === 'candlestick' || item.type === 'k');
    if (!candlestick) return;

    const xAxisIndex = Number(candlestick.xAxisIndex) || 0;
    const yAxisIndex = Number(candlestick.yAxisIndex) || 0;
    const xAxis = option.xAxis;
    const dates = Array.isArray(xAxis) ? xAxis[xAxisIndex] && xAxis[xAxisIndex].data : undefined;
    const yAxis = Array.isArray(option.yAxis) ? option.yAxis[yAxisIndex] : option.yAxis;
    const grid = Array.isArray(option.grid) ? option.grid[0] : option.grid;
    const volumeSeries = series.find(
      (item) => item.type === 'bar' && item.name && item.name.toString().toLowerCase().includes('vol'),
    );

    emit({
      type: 'echarts_kline',
      data: {
        dates,
        ohlc: candlestick.data,
        volumes: volumeSeries && volumeSeries.data,
        chartMeta: {
          xAxisIndex,
          yAxisIndex,
          gridTop: grid && grid.top,
          gridBottom: grid && grid.bottom,
          gridLeft: grid && grid.left,
          gridRight: grid && grid.right,
          yMin: yAxis && yAxis.min,
          yMax: yAxis && yAxis.max,
        },
      },
    });
  } catch {
    // Ignore single chart failures.
  }
}

function captureExistingCharts(echarts) {
  if (typeof echarts.getInstanceByDom !== 'function') return;

  const elements = Array.from(document.querySelectorAll('[_echarts_instance_], canvas'));
  for (const element of elements) {
    try {
      const host = element instanceof HTMLCanvasElement ? (element.parentElement || element) : element;
      const instance =
        echarts.getInstanceByDom(host) ||
        (host.parentElement ? echarts.getInstanceByDom(host.parentElement) : undefined);
      if (!instance) continue;
      registerChartInstance(instance);
      extractChartData(instance.getOption());
    } catch {
      // Ignore per-instance failures.
    }
  }
}

function findCandlestickSeriesIndex(option) {
  if (!option || !Array.isArray(option.series)) return -1;
  return option.series.findIndex((item) => item && (item.type === 'candlestick' || item.type === 'k'));
}

function findCategoryIndex(axisData, targetDate) {
  if (!Array.isArray(axisData) || !axisData.length || !targetDate) return -1;

  const exactIndex = axisData.findIndex((item) => String(item) === String(targetDate));
  if (exactIndex >= 0) return exactIndex;

  return axisData.findIndex((item) => String(item).includes(String(targetDate)) || String(targetDate).includes(String(item)));
}

function getAnnotationColor(kind) {
  if (kind === 'support') return '#4CAF50';
  if (kind === 'resistance') return '#FF8A65';
  if (kind === 'ma20') return '#FFD54F';
  if (kind === 'high') return '#64B5F6';
  if (kind === 'low') return '#BA68C8';
  return '#7C8CFF';
}

function buildMarkPointData(point, axisData) {
  if (!point || !Number.isFinite(point.value)) return null;

  const categoryIndex = point.date ? findCategoryIndex(axisData, point.date) : axisData.length - 1;
  if (categoryIndex < 0 || !axisData.length) return null;
  const xValue = axisData[Math.max(0, categoryIndex)];

  return {
    name: point.label,
    value: Number(point.value.toFixed(2)),
    coord: [xValue, point.value],
    note: point.note || point.label,
    advice: point.advice || point.note || '',
    symbol: point.kind === 'latest' ? 'pin' : 'circle',
    symbolSize: point.kind === 'latest' ? 48 : 36,
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
      position: 'top',
      distance: 6,
      color: '#fff',
      fontSize: 11,
      fontWeight: 'bold',
      backgroundColor: 'rgba(10, 14, 26, 0.88)',
      borderColor: getAnnotationColor(point.kind),
      borderWidth: 1,
      borderRadius: 4,
      padding: [4, 8],
      formatter(params) {
        return `${params.data.name}`;
      },
    },
  };
}

function buildMarkLineData(point) {
  if (!point || !Number.isFinite(point.value)) return null;

  return {
    name: point.label,
    yAxis: Number(point.value.toFixed(2)),
    note: point.note || point.label,
    lineStyle: {
      color: getAnnotationColor(point.kind),
      type: point.kind === 'ma20' ? 'dashed' : 'solid',
      width: point.kind === 'ma20' ? 1.5 : 2,
      opacity: 0.92,
    },
    label: {
      show: true,
      position: 'insideEndTop',
      color: getAnnotationColor(point.kind),
      backgroundColor: 'rgba(10, 14, 26, 0.88)',
      borderRadius: 4,
      padding: [4, 6],
      formatter(params) {
        return `${params.data.name}`;
      },
    },
  };
}

function alignIndicatorData(axisData, data) {
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

function buildIndicatorSeries(axisData, indicators, xAxisIndex, yAxisIndex) {
  if (!indicators) return [];
  const configs = [
    { key: 'ma5', name: 'MA5', color: '#FFD700' },
    { key: 'ma10', name: 'MA10', color: '#FF6B6B' },
    { key: 'ma20', name: 'MA20', color: '#4ECDC4' },
  ];
  const seriesList = [];
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

function buildAnnotationOption(option, annotation) {
  if (!annotation || !Array.isArray(annotation.points) || annotation.points.length === 0) return null;

  const candlestickSeriesIndex = findCandlestickSeriesIndex(option);
  if (candlestickSeriesIndex < 0) return null;

  const candlestickSeries = option.series[candlestickSeriesIndex];
  const xAxisIndex = Number(candlestickSeries && candlestickSeries.xAxisIndex) || 0;
  const yAxisIndex = Number(candlestickSeries && candlestickSeries.yAxisIndex) || 0;
  const axisData = Array.isArray(option.xAxis)
    ? option.xAxis[xAxisIndex] && Array.isArray(option.xAxis[xAxisIndex].data)
      ? option.xAxis[xAxisIndex].data
      : []
    : Array.isArray(option.xAxis && option.xAxis.data)
      ? option.xAxis.data
      : [];

  const markPoints = annotation.points
    .filter((point) => point.kind === 'latest' || point.kind === 'high' || point.kind === 'low')
    .map((point) => buildMarkPointData(point, axisData))
    .filter(Boolean);

  const markLines = annotation.points
    .filter((point) => point.kind === 'latest' || point.kind === 'support' || point.kind === 'resistance' || point.kind === 'ma20')
    .map((point) => buildMarkLineData(point))
    .filter(Boolean);

  const seriesPatch = option.series.map(() => ({}));
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

  const indicatorSeries = buildIndicatorSeries(axisData, annotation.indicators, xAxisIndex, yAxisIndex);
  const existingIds = new Set(option.series.map((s) => s.id).filter(Boolean));
  for (const s of indicatorSeries) {
    if (existingIds.has(s.id)) {
      const idx = option.series.findIndex((os) => os.id === s.id);
      if (idx >= 0) seriesPatch[idx] = s;
    } else {
      seriesPatch.push(s);
    }
  }

  return { series: seriesPatch };
}

function findAnnotationContext(instance, annotation) {
  if (!instance || !annotation) return null;

  const option = instance.getOption();
  const seriesIndex = findCandlestickSeriesIndex(option);
  if (seriesIndex < 0) return null;

  const candlestickSeries = option.series[seriesIndex];
  const xAxisIndex = Number(candlestickSeries && candlestickSeries.xAxisIndex) || 0;
  const yAxisIndex = Number(candlestickSeries && candlestickSeries.yAxisIndex) || 0;
  const axisData = Array.isArray(option.xAxis)
    ? option.xAxis[xAxisIndex] && Array.isArray(option.xAxis[xAxisIndex].data)
      ? option.xAxis[xAxisIndex].data
      : []
    : Array.isArray(option.xAxis && option.xAxis.data)
      ? option.xAxis.data
      : [];

  return { option, seriesIndex, xAxisIndex, yAxisIndex, axisData };
}

function getOverlayShortLabel(kind) {
  if (kind === 'support') return '支撑';
  if (kind === 'resistance') return '阻力';
  if (kind === 'ma20') return 'MA20';
  if (kind === 'high') return '高点';
  if (kind === 'low') return '低点';
  return '现价';
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getOrCreateDomOverlay() {
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

function renderPreciseAnnotationOverlay(instance, annotation) {
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
  if (!content) return;

  // Align overlay with ECharts content box to match convertToPixel coordinate origin
  const top = rect.top + (dom.clientTop || 0);
  const left = rect.left + (dom.clientLeft || 0);
  overlay.style.top = `${Math.max(0, top)}px`;
  overlay.style.left = `${Math.max(0, left)}px`;
  overlay.style.width = `${dom.clientWidth}px`;
  overlay.style.height = `${dom.clientHeight}px`;

  const visiblePoints = annotation.points
    .filter((point) => point && Number.isFinite(point.value))
    .map((point) => {
      const xIndex = point.date ? findCategoryIndex(context.axisData, point.date) : context.axisData.length - 1;
      const xValue = context.axisData[Math.max(0, xIndex)] ?? xIndex;
      let pixel = instance.convertToPixel(
        { xAxisIndex: context.xAxisIndex, yAxisIndex: context.yAxisIndex },
        [xValue, point.value],
      );
      if (!Array.isArray(pixel) || !Number.isFinite(pixel[1])) {
        pixel = instance.convertToPixel({ seriesIndex: context.seriesIndex }, [xValue, point.value]);
      }
      return {
        ...point,
        x: Array.isArray(pixel) ? pixel[0] : null,
        y: Array.isArray(pixel) ? pixel[1] : null,
      };
    })
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
    .sort((a, b) => a.y - b.y);

  emitDebug('overlay', '已计算图上点位', visiblePoints.length);

  const legendHtml = visiblePoints
    .slice(0, 5)
    .map((point) => `
      <div class="legend-item">
        <span class="legend-dot" style="--line-color:${getAnnotationColor(point.kind)};"></span>
        <span class="legend-text">${escapeHtml(point.label)}: ${escapeHtml(point.note)}</span>
      </div>
    `)
    .join('');

  const linesHtml = visiblePoints
    .map((point) => `
      <div class="line" style="top:${point.y}px; --line-color:${getAnnotationColor(point.kind)};">
        <div class="kind-tag">${escapeHtml(getOverlayShortLabel(point.kind))}</div>
        <div class="rule"></div>
        <div class="dot"></div>
        <div class="price-tag">${escapeHtml(point.label)}</div>
      </div>
    `)
    .join('');

  const markersHtml = visiblePoints
    .map((point) => `
      <div class="marker" data-label="${escapeHtml(point.label)}" data-advice="${escapeHtml(point.advice || point.note || '')}" style="left:${point.x}px;top:${point.y}px;--line-color:${getAnnotationColor(point.kind)};">
        <div class="marker-label">${escapeHtml(getOverlayShortLabel(point.kind))}</div>
      </div>
    `)
    .join('');

  content.innerHTML = `<div class="legend">${legendHtml}</div>${linesHtml}${markersHtml}`;

  // Bind click events to markers
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

function getOrCreateChartTooltip() {
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

function showChartTooltip(x, y, title, content) {
  const tooltip = getOrCreateChartTooltip();
  tooltip.innerHTML = `<div style="font-weight:600;margin-bottom:4px;color:#a5b4fc">${escapeHtml(title)}</div><div>${escapeHtml(content)}</div>`;
  tooltip.style.left = `${Math.min(window.innerWidth - 300, Math.max(8, x + 12))}px`;
  tooltip.style.top = `${Math.min(window.innerHeight - 120, Math.max(8, y + 12))}px`;
  tooltip.style.opacity = '1';
  if (tooltip._hideTimer) clearTimeout(tooltip._hideTimer);
  tooltip._hideTimer = setTimeout(() => { tooltip.style.opacity = '0'; }, 6000);
}

function hideChartTooltipOnClick() {
  document.addEventListener('click', (e) => {
    const tooltip = document.getElementById(CHART_TOOLTIP_ID);
    if (tooltip && !tooltip.contains(e.target)) {
      tooltip.style.opacity = '0';
    }
  });
}
hideChartTooltipOnClick();

function applyChartAnnotation(instance) {
  if (!instance || !latestChartAnnotation) return;

  try {
    const option = instance.getOption();
    const annotationOption = buildAnnotationOption(option, latestChartAnnotation);
    if (annotationOption) {
      const originalSetOption = instance.__cs2OriginalSetOption || instance.setOption.bind(instance);
      originalSetOption(annotationOption);
      emitDebug('markline', '已尝试写入 ECharts 标注');
    } else {
      emitDebug('markline', '未生成可用的 ECharts 标注');
    }

    if (!instance._cs2ClickBound) {
      instance._cs2ClickBound = true;
      instance.on('click', function (params) {
        if (params && params.componentType === 'markPoint' && params.data && params.data.advice) {
          const ev = params.event || {};
          showChartTooltip(ev.clientX, ev.clientY, params.data.name, params.data.advice);
        }
      });
    }

    bindDomOverlayListeners();
    renderPreciseAnnotationOverlay(instance, latestChartAnnotation);
  } catch (err) {
    emitDebug('annotation-error', '标注应用失败: ' + (err && err.message ? err.message : String(err)));
    chartInstances.delete(instance);
  }
}

function patchECharts(echarts) {
  const origInit = echarts.init;
  echarts.init = function (...args) {
    const instance = origInit.apply(this, args);
    const origSetOption = instance.setOption.bind(instance);
    instance.__cs2OriginalSetOption = origSetOption;

    instance.setOption = function (option, ...rest) {
      extractChartData(option);
      const result = origSetOption(option, ...rest);
      queueMicrotask(() => {
        applyChartAnnotation(instance);
      });
      return result;
    };

    queueMicrotask(() => {
      try {
        extractChartData(instance.getOption());
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
    const echarts = window.echarts;
    if (echarts && typeof echarts === 'object' && 'init' in echarts) {
      clearInterval(timer);
      patchECharts(echarts);
      captureExistingCharts(echarts);

      let replayCount = 0;
      const replayTimer = setInterval(() => {
        replayCount++;
        captureExistingCharts(echarts);
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
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (!event.data || event.data.source !== 'cs2-ai-content') return;
    if (event.data.type !== ANNOTATION_EVENT_NAME) return;

    latestChartAnnotation = event.data.payload;
    emitDebug('annotation-message', '已收到内容脚本点位数据', Array.isArray(latestChartAnnotation?.points) ? latestChartAnnotation.points.length : 0);

    for (const instance of chartInstances) {
      applyChartAnnotation(instance);
    }
  });
}

installInterceptors();
installEChartsHook();
installAnnotationListener();
