export const AI_PROVIDERS = [
  { id: 'deepseek', label: 'DeepSeek' },
  { id: 'qwen', label: '通义千问' },
] as const

export type AiProvider = (typeof AI_PROVIDERS)[number]['id']

export const DEFAULT_AI_PROVIDER: AiProvider = 'deepseek'

export function isAiProvider(value: unknown): value is AiProvider {
  return AI_PROVIDERS.some((provider) => provider.id === value)
}

export function normalizeAiProvider(value: unknown): AiProvider {
  return isAiProvider(value) ? value : DEFAULT_AI_PROVIDER
}