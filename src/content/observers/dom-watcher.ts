// ============================================================
// DOM Watcher — observe page mutations for SPA navigation
// ============================================================

type Callback = () => void;

/**
 * Watch for DOM changes that indicate:
 * 1. Page content has loaded (for initial data extraction)
 * 2. SPA navigation (user navigated to a new goods page)
 */
export class DOMWatcher {
  private observer: MutationObserver | null = null;
  private onContentReady: Callback;
  private onNavigation: Callback;
  private lastUrl: string;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private started = false;
  private popstateHandler: (() => void) | null = null;

  constructor(onContentReady: Callback, onNavigation: Callback) {
    this.onContentReady = onContentReady;
    this.onNavigation = onNavigation;
    this.lastUrl = window.location.href;
  }

  start() {
    if (this.started) return;

    if (!document.body) {
      const boot = () => {
        document.removeEventListener('DOMContentLoaded', boot);
        this.start();
      };
      document.addEventListener('DOMContentLoaded', boot, { once: true });
      return;
    }

    this.started = true;

    // Watch for URL changes (SPA navigation)
    this.observer = new MutationObserver(() => {
      // Check for URL change
      if (window.location.href !== this.lastUrl) {
        this.lastUrl = window.location.href;
        this.onNavigation();
      }

      // Debounced content-ready check
      if (this.debounceTimer) clearTimeout(this.debounceTimer);
      this.debounceTimer = setTimeout(() => {
        if (this.isContentLoaded()) {
          this.onContentReady();
        }
      }, 500);
    });

    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    // Also listen for popstate (back/forward navigation)
    this.popstateHandler = () => {
      this.lastUrl = window.location.href;
      this.onNavigation();
    };
    window.addEventListener('popstate', this.popstateHandler);
  }

  stop() {
    this.observer?.disconnect();
    this.observer = null;
    if (this.popstateHandler) {
      window.removeEventListener('popstate', this.popstateHandler);
      this.popstateHandler = null;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.started = false;
  }

  /** Check if the page's main content has rendered */
  private isContentLoaded(): boolean {
    // Look for indicators that the SPA has rendered content
    return !!(
      document.querySelector('[_echarts_instance_]') ||
      document.querySelector('canvas') ||
      document.querySelector('[class*="goods"]') ||
      document.querySelector('[class*="price"]')
    );
  }
}

/** Wait for a specific element to appear in the DOM */
export function waitForElement(selector: string, timeout = 15000): Promise<HTMLElement> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(selector);
    if (existing) {
      resolve(existing as HTMLElement);
      return;
    }

    const observer = new MutationObserver(() => {
      const el = document.querySelector(selector);
      if (el) {
        observer.disconnect();
        resolve(el as HTMLElement);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    setTimeout(() => {
      observer.disconnect();
      reject(new Error(`Element "${selector}" not found within ${timeout}ms`));
    }, timeout);
  });
}
