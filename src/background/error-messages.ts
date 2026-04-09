import type { LLMProviderType } from '@shared/types';

export function humanizeProviderError(provider: LLMProviderType, rawError: string): string {
  const error = rawError.trim();
  const lower = error.toLowerCase();

  if (provider === 'kimi_code' || lower.includes('kimi for coding is currently only available')) {
    return 'Kimi Code 只允许官方支持的 Coding Agents 使用，普通浏览器插件会被服务端拒绝。请改用 Moonshot Kimi（开放平台）或其他供应商。';
  }

  if (lower.includes('401') || lower.includes('invalid authentication') || lower.includes('unauthorized')) {
    const providerHint = provider === 'kimi'
      ? '这更像是用了错误类型的 Key，或者你填的不是 Moonshot 开放平台 Key。'
      : '通常是 API Key 填错、粘贴不完整，或者用错了平台。';
    return `认证失败，服务器没有认可这把 API Key。${providerHint}`;
  }

  if (lower.includes('403') || lower.includes('forbidden') || lower.includes('access_terminated_error')) {
    return '权限不足，这个 Key 没有权限调用当前模型，或者该平台限制了调用来源。';
  }

  if (lower.includes('model') && (lower.includes('not found') || lower.includes('does not exist') || lower.includes('invalid'))) {
    return '模型名不对，或者这个账号没有该模型权限。可以先切回推荐模型再测试。';
  }

  if (lower.includes('quota') || lower.includes('insufficient') || lower.includes('balance')) {
    return '额度不足或账户未开通计费，先去对应平台检查余额、套餐或配额。';
  }

  if (lower.includes('rate limit') || lower.includes('too many requests') || lower.includes('429')) {
    return '请求太频繁，被平台限流了。稍等一会儿再试会更稳。';
  }

  if (lower.includes('failed to fetch') || lower.includes('network') || lower.includes('timeout')) {
    return '网络请求没有成功发出去，可能是网络、代理或跨域权限的问题。';
  }

  return error;
}
