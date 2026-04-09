// ============================================================
// LLM Router — unified interface, dispatches to user-selected provider
// ============================================================

import type { LLMMessage, LLMProviderType, LLMConfig } from '@shared/types';
import { getLLMConfig } from '@shared/storage';
import type { LLMProvider, StreamOptions } from './providers/base';
import { claudeProvider } from './providers/claude';
import {
  openaiProvider,
  deepseekProvider,
  qwenProvider,
  kimiProvider,
  kimiCodeProvider,
  glmProvider,
  ollamaProvider,
} from './providers/openai';
import { geminiProvider } from './providers/gemini';

const providers: Record<LLMProviderType, LLMProvider> = {
  claude: claudeProvider,
  openai: openaiProvider,
  deepseek: deepseekProvider,
  qwen: qwenProvider,
  kimi: kimiProvider,
  kimi_code: kimiCodeProvider,
  glm: glmProvider,
  gemini: geminiProvider,
  ollama: ollamaProvider,
};

function getProvider(config: LLMConfig): LLMProvider {
  const provider = providers[config.provider];
  if (!provider) throw new Error(`Unknown LLM provider: ${config.provider}`);
  return provider;
}

function buildOptions(config: LLMConfig): StreamOptions {
  return {
    model: config.model,
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    temperature: config.temperature,
    maxTokens: config.maxTokens,
  };
}

/** Stream LLM response using user's configured provider */
export async function* streamChat(messages: LLMMessage[]): AsyncGenerator<string> {
  const config = await getLLMConfig();
  if (!config.apiKey && config.provider !== 'ollama') {
    throw new Error('当前没有可用的 API Key');
  }
  const provider = getProvider(config);
  yield* provider.chatStream(messages, buildOptions(config));
}

/** Non-streaming LLM call */
export async function chat(messages: LLMMessage[]): Promise<string> {
  const config = await getLLMConfig();
  if (!config.apiKey && config.provider !== 'ollama') {
    throw new Error('当前没有可用的 API Key');
  }
  const provider = getProvider(config);
  return provider.chat(messages, buildOptions(config));
}

/** Test connection with current settings */
export async function testConnection(): Promise<{ ok: boolean; error?: string }> {
  const config = await getLLMConfig();
  const provider = getProvider(config);
  return provider.testConnection(buildOptions(config));
}

/** Get available models for a provider */
export function getAvailableModels(providerType: LLMProviderType): string[] {
  return providers[providerType]?.defaultModels ?? [];
}
