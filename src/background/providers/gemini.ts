// ============================================================
// Google Gemini Provider
// ============================================================

import type { LLMMessage } from '@shared/types';
import { BaseLLMProvider, type StreamOptions } from './base';

export class GeminiProvider extends BaseLLMProvider {
  readonly name = 'Gemini';
  readonly defaultBaseUrl = 'https://generativelanguage.googleapis.com';
  readonly defaultModels = ['gemini-2.5-flash', 'gemini-2.5-pro'];

  async *chatStream(messages: LLMMessage[], options: StreamOptions): AsyncGenerator<string> {
    const baseUrl = (options.baseUrl || this.defaultBaseUrl).replace(/\/+$/, '');
    const model = options.model || this.defaultModels[0];

    // Convert messages to Gemini format
    const systemMsg = messages.find((m) => m.role === 'system');
    const chatMsgs = messages.filter((m) => m.role !== 'system');
    const contents = chatMsgs.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    const url = `${baseUrl}/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${options.apiKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents,
        ...(systemMsg
          ? { systemInstruction: { parts: [{ text: systemMsg.content }] } }
          : {}),
        generationConfig: {
          temperature: options.temperature ?? 0.3,
          maxOutputTokens: options.maxTokens ?? 2000,
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini API error ${response.status}: ${errorText}`);
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
        if (!trimmed.startsWith('data: ')) continue;
        try {
          const data = JSON.parse(trimmed.slice(6));
          const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) yield text;
        } catch {
          // Skip malformed lines
        }
      }
    }
  }
}

export const geminiProvider = new GeminiProvider();
