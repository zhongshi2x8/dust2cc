// ============================================================
// XHR/Fetch Interceptor — captures csqaq API responses
// ============================================================
//
// This runs as an injected page script (not content script)
// because content scripts can't intercept page-level fetch/XHR.
// Communication back to content script via CustomEvent.

import type { KlinePoint, GoodsInfo, PriceInfo, Listing } from '@shared/types';

const EVENT_NAME = 'cs2-ai-data-captured';

interface CapturedPayload {
  type: 'kline' | 'goods_detail' | 'listings' | 'price';
  data: unknown;
}

function emit(payload: CapturedPayload) {
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: payload }));
}

/** Install fetch interceptor */
function hookFetch() {
  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const response = await originalFetch.apply(this, args);
    const url = typeof args[0] === 'string' ? args[0] : (args[0] as Request).url;

    // Clone so original consumer isn't affected
    tryCaptureFetch(url, response.clone());
    return response;
  };
}

/** Install XMLHttpRequest interceptor */
function hookXHR() {
  const OrigXHR = window.XMLHttpRequest;
  const origOpen = OrigXHR.prototype.open;

  OrigXHR.prototype.open = function (
    method: string,
    url: string | URL,
    async?: boolean,
    username?: string | null,
    password?: string | null,
  ) {
    (this as XMLHttpRequest & { _cs2Url: string })._cs2Url = url.toString();
    return origOpen.call(this, method, url, async ?? true, username ?? undefined, password ?? undefined);
  };

  const origSend = OrigXHR.prototype.send;
  OrigXHR.prototype.send = function (body?: Document | XMLHttpRequestBodyInit | null) {
    this.addEventListener('load', function () {
      const url = (this as XMLHttpRequest & { _cs2Url: string })._cs2Url;
      tryCaptureXHR(url, this.responseText);
    });
    return origSend.call(this, body);
  };
}

// ----- URL pattern matching & data extraction -----

async function tryCaptureFetch(url: string, response: Response) {
  try {
    if (matchesKline(url)) {
      const json = await response.json();
      emit({ type: 'kline', data: json });
    } else if (matchesGoodsDetail(url)) {
      const json = await response.json();
      emit({ type: 'goods_detail', data: json });
    } else if (matchesListings(url)) {
      const json = await response.json();
      emit({ type: 'listings', data: json });
    }
  } catch {
    // Silently fail — don't break the host page
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
    // Silently fail
  }
}

function matchesKline(url: string): boolean {
  return /api\/v1\/info\/chart|api\/v1\/info\/simple\/chartAll|api\/v1\/sub\/kline|kline|chart|trend|history/i.test(url);
}

function matchesGoodsDetail(url: string): boolean {
  return /api\/v1\/info\/good(\?|\/|$)|goods\/detail|item\/info|goods\/info/i.test(url);
}

function matchesListings(url: string): boolean {
  return /api\/v1\/info\/good\/statistic|listing|sell_order|on_sale/i.test(url);
}

// ----- Bootstrap -----

export function installInterceptors() {
  hookFetch();
  hookXHR();
  console.log('[CS2 AI Analyst] Network interceptors installed');
}
