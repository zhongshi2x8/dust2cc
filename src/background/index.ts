// ============================================================
// Background Service Worker — message hub & LLM orchestrator
// ============================================================

import { streamChat, testConnection } from './llm-router';
import { getSettings, saveSettings } from '@shared/storage';
import type { ExtensionMessage, LLMConfig, LLMMessage } from '@shared/types';
import { humanizeProviderError } from './error-messages';

// ----- Message Handler -----

chrome.runtime.onMessage.addListener(
  (message: ExtensionMessage, _sender, sendResponse) => {
    handleMessage(message, sendResponse);
    return true; // Keep channel open for async response
  },
);

async function handleMessage(
  msg: ExtensionMessage,
  sendResponse: (response: unknown) => void,
) {
  try {
    switch (msg.type) {
      case 'GET_SETTINGS': {
        const settings = await getSettings();
        sendResponse({ ok: true, data: settings });
        break;
      }
      case 'SAVE_SETTINGS': {
        await saveSettings(msg.data as Record<string, unknown>);
        sendResponse({ ok: true });
        break;
      }
      case 'TEST_CONNECTION':
      case 'TEST_LLM_CONNECTION': {
        await handleTestConnectionMessage(msg.data as Partial<LLMConfig> | undefined, sendResponse);
        break;
      }
      default:
        sendResponse({ ok: false, error: `Unknown message type: ${msg.type}` });
    }
  } catch (e) {
    sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
}

async function handleTestConnectionMessage(
  configOverride: Partial<LLMConfig> | undefined,
  sendResponse: (response: unknown) => void,
) {
  const settings = await getSettings();
  const result = await testConnection(configOverride);
  if (!result.ok && result.error) {
    const provider = configOverride?.provider || settings.llm.provider;
    result.error = humanizeProviderError(provider, result.error);
  }
  sendResponse({ ok: true, data: result });
}

// ----- Streaming LLM via Port -----

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'llm-stream') return;

  port.onMessage.addListener(async (msg: { messages: LLMMessage[]; configOverride?: Partial<LLMConfig> }) => {
    try {
      for await (const chunk of streamChat(msg.messages, msg.configOverride)) {
        port.postMessage({ type: 'chunk', text: chunk });
      }
      port.postMessage({ type: 'done' });
    } catch (e) {
      const settings = await getSettings();
      const provider = msg.configOverride?.provider || settings.llm.provider;
      port.postMessage({
        type: 'error',
        error: humanizeProviderError(
          provider,
          e instanceof Error ? e.message : String(e),
        ),
      });
    }
  });
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {
    // Ignore unsupported browser builds.
  });

  chrome.contextMenus?.create({
    id: 'cs2-ai-analyze',
    title: 'AI 分析此饰品',
    contexts: ['page'],
    documentUrlPatterns: [
      'https://csqaq.com/*',
      'https://*.csqaq.com/*',
      'https://steamdt.com/*',
      'https://*.steamdt.com/*',
    ],
  });
});

// ----- Context Menu -----

chrome.contextMenus?.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'cs2-ai-analyze' && tab?.id) {
    chrome.tabs.sendMessage(tab.id, { type: 'REQUEST_ANALYSIS' });
  }
});

console.log('[dust2cc] Background service worker initialized');
