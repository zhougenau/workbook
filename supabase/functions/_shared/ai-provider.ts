import { DEFAULT_AI_PROVIDER, isAiProvider, type AiProvider } from '../../../packages/core/src/ai-provider.ts'
import { withPaidBudget } from './paid-budget.ts'
import type { resolveOwner } from './resolve-owner.ts'
export type { AiProvider } from '../../../packages/core/src/ai-provider.ts'

type Message = { role: 'system' | 'user' | 'assistant'; content: string }
type Owner = NonNullable<Awaited<ReturnType<typeof resolveOwner>>>

export function parseAiProvider(value: unknown): AiProvider | null {
  return value === undefined ? DEFAULT_AI_PROVIDER : isAiProvider(value) ? value : null
}

export function hasAiProviderKey(provider: AiProvider): boolean {
  return Boolean(Deno.env.get(provider === 'qwen' ? 'DASHSCOPE_API_KEY' : 'DEEPSEEK_API_KEY'))
}

export async function callAiProvider(owner: Owner, provider: AiProvider, messages: Message[], options: {
  timeout: number
  maxTokens: number
  temperature?: number
  json?: boolean
}) {
  const qwen = provider === 'qwen'
  const apiKey = Deno.env.get(qwen ? 'DASHSCOPE_API_KEY' : 'DEEPSEEK_API_KEY')
  if (!apiKey) throw new Error(`${qwen ? '通义千问' : 'DeepSeek'} API Key 未配置`)

  const inputBytes = messages.reduce((total, message) => total + new TextEncoder().encode(message.content).length, 0)
  return withPaidBudget(owner, 'text', inputBytes + options.maxTokens + 2048, async () => {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), options.timeout)
    try {
      const response = await fetch(qwen
        ? 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions'
        : 'https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: qwen ? 'qwen-flash' : 'deepseek-v4-flash',
          messages,
          ...(qwen ? {} : { thinking: { type: 'disabled' } }),
          ...(options.json ? { response_format: { type: 'json_object' } } : {}),
          stream: false,
          max_tokens: options.maxTokens,
          ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
        }),
        signal: controller.signal,
      })
      if (!response.ok) {
        const details = await response.text()
        throw new Error(`${qwen ? '通义千问' : 'DeepSeek'} API ${response.status}: ${details.slice(0, 300)}`)
      }
      const payload = await response.json()
      const content = payload?.choices?.[0]?.message?.content
      if (typeof content !== 'string' || !content.trim()) throw new Error('AI 返回了空内容')
      const usage = payload?.usage
      return {
        content,
        tokenUsage: {
          promptTokens: Number.isInteger(usage?.prompt_tokens) ? usage.prompt_tokens : 0,
          completionTokens: Number.isInteger(usage?.completion_tokens) ? usage.completion_tokens : 0,
          totalTokens: Number.isInteger(usage?.total_tokens) ? usage.total_tokens : 0,
        },
      }
    } finally {
      clearTimeout(timeout)
    }
  }, (result) => result.tokenUsage.totalTokens)
}