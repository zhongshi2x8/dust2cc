import type { LLMConfig, LLMProviderType } from './types';

export function isCustomProvider(provider: LLMProviderType): boolean {
  return provider === 'openai_compatible_custom';
}

export function providerAllowsNoApiKey(config: Pick<LLMConfig, 'provider' | 'allowNoApiKey'>): boolean {
  return config.provider === 'ollama'
    || (config.provider === 'openai_compatible_custom' && config.allowNoApiKey === true);
}

export function validateLLMConfig(config: LLMConfig): string | null {
  if (isCustomProvider(config.provider) && !config.baseUrl?.trim()) {
    return '请先填写 Base URL';
  }

  if (isCustomProvider(config.provider) && !config.model.trim()) {
    return '请先填写 Model';
  }

  if (!providerAllowsNoApiKey(config) && !config.apiKey.trim()) {
    return '请先填写 API Key';
  }

  return null;
}
