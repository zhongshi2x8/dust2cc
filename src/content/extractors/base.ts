// ============================================================
// Site Extractor Registry
// ============================================================

import type { SiteAdapter } from '@shared/types';
import { csqaqExtractor } from './csqaq';
import { steamdtExtractor } from './steamdt';

const adapters: SiteAdapter[] = [
  csqaqExtractor,
  steamdtExtractor,
];

/** Find the matching adapter for the current page URL */
export function getAdapterForUrl(url: string): SiteAdapter | null {
  for (const adapter of adapters) {
    if (adapter.matchUrl.test(url)) return adapter;
  }
  return null;
}
