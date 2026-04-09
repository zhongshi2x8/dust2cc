// ============================================================
// Claude (Anthropic) Provider — Messages API
// ============================================================

import type { LLMMessage } from '@shared/types';
import { BaseLLMProvider, type StreamOptions } from './base';

export class ClaudeProvider extends BaseLLMProvider {
  readonly name = 'Claude';
  readonly defaultBaseUrl = 'https://api.anthropic.com';
  readonly defaultModels = [
    'claude-sonnet-4-20250514',
    'claude-haiku-4-5-20251001',
    'claude-opus-4-20250514',
  ];

  async *chatStream(messages: LLMMessage[], options: StreamOptions): AsyncGenerator<string> {
    const baseUrl = (options.baseUrl || this.defaultBaseUrl).replace(/\/+$/, '');

    // Separate system message (Claude API uses a top-level `system` field)
    const systemMsg = messages.find((m) => m.role === 'system');
    const chatMsgs = messages.filter((m) => m.role !== 'system');

    const response = await fetch(`${baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': options.apiKey,
        'anthropic-version': '2023-06-01',
        // Required for browser-based requests
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: options.model || this.defaultModels[0],
        max_tokens: options.maxTokens ?? 2000,
        temperature: options.temperature ?? 0.3,
        stream: true,
        ...(systemMsg ? { system: systemMsg.content } : {}),
        messages: chatMsgs.map((m) => ({ role: m.role, content: m.content })),
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Claude API error ${response.status}: ${errorText}`);
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
          if (data.type === 'content_block_delta' && data.delta?.text) {
            yield data.delta.text;
          }
        } catch {
          // Skip non-JSON lines (e.g. event: lines)
        }
      }
    }
  }
}

export const claudeProvider = new ClaudeProvider();
