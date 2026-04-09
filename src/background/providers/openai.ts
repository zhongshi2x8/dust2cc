// ============================================================
// OpenAI-Compatible Provider
// Covers: OpenAI, DeepSeek, Ollama, one-api, any compatible API
// ============================================================

import type { LLMMessage } from '@shared/types';
import { BaseLLMProvider, type StreamOptions } from './base';

export class OpenAICompatibleProvider extends BaseLLMProvider {
  readonly name: string;
  readonly defaultBaseUrl: string;
  readonly defaultModels: string[];

  constructor(name: string, defaultBaseUrl: string, defaultModels: string[]) {
    super();
    this.name = name;
    this.defaultBaseUrl = defaultBaseUrl;
    this.defaultModels = defaultModels;
  }

  async *chatStream(messages: LLMMessage[], options: StreamOptions): AsyncGenerator<string> {
    const baseUrl = options.baseUrl || this.defaultBaseUrl;
    const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${options.apiKey}`,
      },
      body: JSON.stringify({
        model: options.model,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        stream: true,
        temperature: options.temperature ?? 0.3,
        max_tokens: options.maxTokens ?? 2000,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`${this.name} API error ${response.status}: ${errorText}`);
    }

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop()!;

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data: ') || trimmed === 'data: [DONE]') continue;
        try {
          const json = JSON.parse(trimmed.slice(6));
          const delta = json.choices?.[0]?.delta?.content;
          if (delta) yield delta;
        } catch {
          // Skip malformed lines
        }
      }
    }
  }
}

// Pre-configured providers
export const openaiProvider = new OpenAICompatibleProvider(
  'OpenAI',
  'https://api.openai.com/v1',
  ['gpt-4o', 'gpt-4o-mini', 'o3-mini'],
);

export const deepseekProvider = new OpenAICompatibleProvider(
  'DeepSeek',
  'https://api.deepseek.com/v1',
  ['deepseek-chat', 'deepseek-reasoner'],
);

export const qwenProvider = new OpenAICompatibleProvider(
  'Qwen',
  'https://dashscope.aliyuncs.com/compatible-mode/v1',
  ['qwen-plus', 'qwen-turbo', 'qwen-max'],
);

export const kimiProvider = new OpenAICompatibleProvider(
  'Moonshot Kimi',
  'https://api.moonshot.ai/v1',
  ['kimi-k2.5', 'kimi-k2-thinking', 'kimi-k2-turbo-preview'],
);

export const kimiCodeProvider = new OpenAICompatibleProvider(
  'Kimi Code',
  'https://api.kimi.com/coding/v1',
  ['kimi-for-coding'],
);

export const glmProvider = new OpenAICompatibleProvider(
  'GLM',
  'https://open.bigmodel.cn/api/paas/v4',
  ['glm-4-flash', 'glm-4-plus', 'glm-4-air'],
);

export const ollamaProvider = new OpenAICompatibleProvider(
  'Ollama',
  'http://localhost:11434/v1',
  ['qwen2.5:7b', 'llama3.1:8b', 'deepseek-r1:7b'],
);
