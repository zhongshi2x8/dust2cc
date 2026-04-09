// ============================================================
// LLM Provider — abstract interface
// ============================================================

import type { LLMMessage, LLMConfig } from '@shared/types';

export interface StreamOptions {
  model: string;
  apiKey: string;
  baseUrl?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface LLMProvider {
  readonly name: string;
  readonly defaultBaseUrl: string;
  readonly defaultModels: string[];

  /** Streaming chat — yields text chunks */
  chatStream(messages: LLMMessage[], options: StreamOptions): AsyncGenerator<string>;

  /** Non-streaming chat (convenience wrapper) */
  chat(messages: LLMMessage[], options: StreamOptions): Promise<string>;

  /** Test if the API key + model work */
  testConnection(options: StreamOptions): Promise<{ ok: boolean; error?: string }>;
}

/** Base class with default chat() implementation */
export abstract class BaseLLMProvider implements LLMProvider {
  abstract readonly name: string;
  abstract readonly defaultBaseUrl: string;
  abstract readonly defaultModels: string[];

  abstract chatStream(messages: LLMMessage[], options: StreamOptions): AsyncGenerator<string>;

  async chat(messages: LLMMessage[], options: StreamOptions): Promise<string> {
    let result = '';
    for await (const chunk of this.chatStream(messages, options)) {
      result += chunk;
    }
    return result;
  }

  async testConnection(options: StreamOptions): Promise<{ ok: boolean; error?: string }> {
    try {
      const result = await this.chat(
        [{ role: 'user', content: 'Reply with "ok"' }],
        { ...options, maxTokens: 10 },
      );
      return { ok: result.toLowerCase().includes('ok') };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }
}
