import { parseGeneratedFlashcards, type AiProvider } from '@wordbook/core'
import { getAccessToken, supabase } from './supabase'
import { notifyPaidUsageChanged } from './paidUsage'

async function getFunctionErrorMessage(error: { message: string; context?: unknown }) {
  if (error.context instanceof Response) {
    try {
      const body = await error.context.clone().json() as { error?: unknown }
      if (typeof body.error === 'string' && body.error.trim()) return body.error
    } catch {
      // Fall back to the Supabase client message when the response is not JSON.
    }
  }
  return error.message || 'AI 卡片生成失败'
}

export async function generateFlashcards(wordIds: string[], signal?: AbortSignal, provider?: AiProvider) {
  if (!supabase) throw new Error('尚未配置 Supabase')
  const accessToken = await getAccessToken()
  const { data, error } = await supabase.functions.invoke('generate-flashcards', {
    body: { wordIds, provider },
    headers: { Authorization: `Bearer ${accessToken}` },
    signal,
  })
  if (!signal?.aborted) notifyPaidUsageChanged()
  if (error) throw new Error(await getFunctionErrorMessage(error))
  return parseGeneratedFlashcards(data)
}
