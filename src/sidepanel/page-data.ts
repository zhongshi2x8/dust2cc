import type { PageSnapshot } from '@shared/types';

export async function requestActivePageState(): Promise<PageSnapshot | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return null;

  try {
    const response = await chrome.tabs.sendMessage(tab.id, { type: 'REQUEST_PAGE_STATE' });
    return response?.data ?? null;
  } catch {
    return null;
  }
}
