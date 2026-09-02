import { getAccessToken, supabase } from './supabase'

export type PassageLength = 'short' | 'medium' | 'long'

export type GeneratedPassage = {
  title: string
  passage: string
  translation: string
  usedWords: string[]
  tokenUsage: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
}

async function getFunctionErrorMessage(error: { message: string; context?: unknown }) {
  if (error.context instanceof Response) {
    try {
      const body = await error.context.clone().json() as { error?: unknown }
      if (typeof body.error === 'string' && body.error.trim()) return body.error
    } catch {
      // Fall back to the Supabase client message when the response is not JSON.
    }
  }
  return error.message || 'AI 短文生成失败'
}

function parsePassage(value: unknown): GeneratedPassage {
  if (!value || typeof value !== 'object') throw new Error('AI 返回了无法识别的短文格式')
  const result = value as Record<string, unknown>
  const usage = result.tokenUsage as Record<string, unknown> | undefined
  if (
    typeof result.title !== 'string' || !result.title.trim() ||
    typeof result.passage !== 'string' || !result.passage.trim() ||
    typeof result.translation !== 'string' || !result.translation.trim() ||
    !Array.isArray(result.usedWords) || !result.usedWords.every((word) => typeof word === 'string') ||
    !usage ||
    !Number.isInteger(usage.promptTokens) ||
    !Number.isInteger(usage.completionTokens) ||
    !Number.isInteger(usage.totalTokens)
  ) throw new Error('AI 返回的短文内容不完整')
  return result as GeneratedPassage
}

export async function generatePassage(wordIds: string[], length: PassageLength, signal?: AbortSignal) {
  if (!supabase) throw new Error('尚未配置 Supabase')
  const accessToken = await getAccessToken()
  const { data, error } = await supabase.functions.invoke('generate-passage', {
    body: { wordIds, length },
    headers: { Authorization: `Bearer ${accessToken}` },
    signal,
  })
  if (error) throw new Error(await getFunctionErrorMessage(error))
  return parsePassage(data)
}
