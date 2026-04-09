import type { LLMProviderType } from './types';

export interface ProviderOption {
  id: LLMProviderType;
  name: string;
  summary: string;
  setupLevel: 'easy' | 'advanced';
  recommended?: boolean;
  models: string[];
  placeholder: string;
  helpUrl: string;
}

export const PROVIDERS: ProviderOption[] = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    summary: '最省心，价格低，适合作为默认 AI 深度分析方案。',
    setupLevel: 'easy',
    recommended: true,
    models: ['deepseek-chat', 'deepseek-reasoner'],
    placeholder: 'sk-...',
    helpUrl: 'https://platform.deepseek.com/',
  },
  {
    id: 'qwen',
    name: '通义千问 Qwen',
    summary: '国内接入稳定，中文表现不错，适合日常行情解读。',
    setupLevel: 'easy',
    models: ['qwen-plus', 'qwen-turbo', 'qwen-max'],
    placeholder: 'sk-...',
    helpUrl: 'https://help.aliyun.com/zh/model-studio/compatibility-of-openai-with-dashscope',
  },
  {
    id: 'kimi',
    name: 'Moonshot Kimi',
    summary: '开放平台版 Kimi，可用于这个插件，适合偏长文分析。',
    setupLevel: 'easy',
    models: ['kimi-k2.5', 'kimi-k2-thinking', 'kimi-k2-turbo-preview'],
    placeholder: 'sk-...',
    helpUrl: 'https://platform.moonshot.ai/docs/guide/kimi-k2-5-quickstart',
  },
  {
    id: 'kimi_code',
    name: 'Kimi Code',
    summary: '仅适用于官方支持的 Coding Agents，普通插件通常会被 403 拒绝。',
    setupLevel: 'advanced',
    models: ['kimi-for-coding'],
    placeholder: 'sk-kimi-...',
    helpUrl: 'https://www.kimi.com/code/docs/more/third-party-agents.html',
  },
  {
    id: 'glm',
    name: '智谱 GLM',
    summary: '国产开放平台，接入简单，适合作为 DeepSeek 的备选。',
    setupLevel: 'easy',
    models: ['glm-4-flash', 'glm-4-plus', 'glm-4-air'],
    placeholder: 'your-api-key',
    helpUrl: 'https://docs.bigmodel.cn/cn/guide/develop/openai/introduction',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    summary: '适合已经有 OpenAI Key 的用户。',
    setupLevel: 'advanced',
    models: ['gpt-4o', 'gpt-4o-mini', 'o3-mini'],
    placeholder: 'sk-...',
    helpUrl: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'claude',
    name: 'Claude',
    summary: '长文本理解好，但国内用户配置门槛相对更高。',
    setupLevel: 'advanced',
    models: ['claude-sonnet-4-20250514', 'claude-haiku-4-5-20251001', 'claude-opus-4-20250514'],
    placeholder: 'sk-ant-...',
    helpUrl: 'https://console.anthropic.com/',
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    summary: '适合已经在用 Google AI Studio 的用户。',
    setupLevel: 'advanced',
    models: ['gemini-2.5-flash', 'gemini-2.5-pro'],
    placeholder: 'AIza...',
    helpUrl: 'https://aistudio.google.com/apikey',
  },
  {
    id: 'ollama',
    name: 'Ollama (本地)',
    summary: '本地部署，无需联网，但需要你自己先装并运行模型。',
    setupLevel: 'advanced',
    models: ['qwen2.5:7b', 'llama3.1:8b', 'deepseek-r1:7b'],
    placeholder: '无需 API Key',
    helpUrl: 'https://ollama.com/',
  },
];

export function getProviderOption(providerId: LLMProviderType): ProviderOption | undefined {
  return PROVIDERS.find((provider) => provider.id === providerId);
}
