# SteamDT Inline Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 `steamdt` 错价分析，并恢复网页内紧凑 AI 面板与简洁重点位标记。

**Architecture:** 在共享层增加价格候选排序工具，让内容脚本、站点提取器和 `side panel` 统一使用同一套价格选择规则。`steamdt` 页面使用新的面板锚点策略，把紧凑 AI 面板插入商品详情空白区，同时对图内标记做轻量化处理。

**Tech Stack:** TypeScript, React, Chrome Extension MV3, Vitest, Vite

---

### Task 1: Price Selection Safety Net

**Files:**
- Create: `src/shared/price-selection.ts`
- Create: `src/shared/price-selection.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { pickBestPriceCandidate } from './price-selection';

describe('pickBestPriceCandidate', () => {
  it('prefers the candidate closest to the latest kline close', () => {
    const result = pickBestPriceCandidate(
      [
        { value: 23, weight: 8 },
        { value: 459, weight: 8 },
      ],
      465,
    );

    expect(result?.value).toBe(459);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/shared/price-selection.test.ts`
Expected: FAIL because the module does not exist yet

- [ ] **Step 3: Write minimal implementation**

```ts
export interface PriceCandidate {
  value?: number;
  weight?: number;
}

export function pickBestPriceCandidate<T extends PriceCandidate>(
  candidates: T[],
  referencePrice?: number,
): T | undefined {
  // score by candidate weight plus distance to reference price
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/shared/price-selection.test.ts`
Expected: PASS

### Task 2: SteamDT Price Correction

**Files:**
- Modify: `src/content/extractors/steamdt.ts`
- Modify: `src/content/index.ts`
- Modify: `src/sidepanel/views/AnalysisView.tsx`

- [ ] **Step 1: Add a failing regression test for wrong-price fallback**

```ts
it('falls back away from an obviously wrong low outlier when close price is available', () => {
  const result = pickBestPriceCandidate(
    [
      { value: 23, weight: 12 },
      { value: 465, weight: 0 },
    ],
    465,
  );

  expect(result?.value).toBe(465);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/shared/price-selection.test.ts`
Expected: FAIL until the fallback scoring is implemented

- [ ] **Step 3: Implement corrected price usage**

```ts
const lastClose = pageData.kline[pageData.kline.length - 1]?.close;
const resolvedPrice = pickBestPriceCandidate(
  [{ value: pageData.price?.current, weight: 10 }, { value: lastClose, weight: 0 }],
  lastClose,
)?.value ?? lastClose;
```

- [ ] **Step 4: Run targeted tests**

Run: `npm test -- src/shared/price-selection.test.ts src/content/extractors/steamdt.test.ts`
Expected: PASS

### Task 3: Restore SteamDT Inline Panel

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/content/extractors/steamdt.ts`
- Modify: `src/content/index.ts`
- Modify: `src/content/injector/panel.ts`

- [ ] **Step 1: Add a failing test for steamdt panel placement helper**

```ts
it('can resolve a hero-area anchor for the inline panel', () => {
  document.body.innerHTML = `<main><section class="detail-summary"><h1>Item</h1><div class="price-main">¥459</div></section></main>`;
  expect(steamdtExtractor.getPanelAnchor?.()).not.toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails if helper is missing**

Run: `npm test -- src/content/extractors/steamdt.test.ts`
Expected: FAIL until `getPanelAnchor()` is implemented

- [ ] **Step 3: Implement compact inline panel placement**

```ts
const panelAnchor = currentAdapter.getPanelAnchor?.() ?? currentAdapter.getChartAnchor();
const panel = injectPanel(panelAnchor, {
  siteName: currentAdapter.name,
  placement: currentAdapter.name === 'steamdt' ? 'overlay-top-right' : 'inline-after',
});
```

- [ ] **Step 4: Run targeted tests**

Run: `npm test -- src/content/extractors/steamdt.test.ts`
Expected: PASS

### Task 4: Simplify SteamDT Chart Markers

**Files:**
- Modify: `src/content/index.ts`

- [ ] **Step 1: Implement marker simplification**

```ts
const markerKinds = currentAdapter?.name === 'steamdt'
  ? ['buy_zone', 'stop_loss', 'support', 'resistance']
  : null;
```

- [ ] **Step 2: Keep full report in panel only**

```ts
// steamdt skips the heavy native chart annotation layer
if (currentAdapter?.name !== 'steamdt') {
  window.postMessage(...);
}
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: PASS
