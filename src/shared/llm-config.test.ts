import { describe, expect, it } from 'vitest';
import { providerAllowsNoApiKey, validateLLMConfig } from './llm-config';
import { normalizeSettings } from './storage';

describe('validateLLMConfig', () => {
  it('requires base url for custom provider', () => {
    const llm = normalizeSettings({
      llm: {
        provider: 'openai_compatible_custom',
        apiKey: 'sk-test',
        model: 'gpt-4o-mini',
        baseUrl: '   ',
      },
    }).llm;

    expect(validateLLMConfig(llm)).toBe('请先填写 Base URL');
  });

  it('requires api key for custom provider by default', () => {
    const llm = normalizeSettings({
      llm: {
        provider: 'openai_compatible_custom',
        apiKey: '',
        model: 'gpt-4o-mini',
        baseUrl: 'https://proxy.example.com/v1',
      },
    }).llm;

    expect(validateLLMConfig(llm)).toBe('请先填写 API Key');
  });

  it('allows custom provider without api key only when explicitly enabled', () => {
    const llm = normalizeSettings({
      llm: {
        provider: 'openai_compatible_custom',
        apiKey: '',
        model: 'gpt-4o-mini',
        baseUrl: 'https://proxy.example.com/v1',
        allowNoApiKey: true,
      },
    }).llm;

    expect(providerAllowsNoApiKey(llm)).toBe(true);
    expect(validateLLMConfig(llm)).toBeNull();
  });

  it('keeps ollama keyless mode working', () => {
    const llm = normalizeSettings({
      llm: {
        provider: 'ollama',
        apiKey: '',
      },
    }).llm;

    expect(providerAllowsNoApiKey(llm)).toBe(true);
    expect(validateLLMConfig(llm)).toBeNull();
  });
});
