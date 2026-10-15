import { parseWordChatResponse, type AiProvider, type WordChatMessage } from '@wordbook/core'
import { getAccessToken, supabase } from './supabase'

async function getFunctionErrorMessage(error: { message: string; context?: unknown }) {
  if (error.context instanceof Response) {
    try {
      const body = await error.context.clone().json() as { error?: unknown }
      if (typeof body.error === 'string' && body.error.trim()) return body.error
    } catch {
      // Fall back to the Supabase client message when the response is not JSON.
    }
  }
  return error.message || 'AI 对话暂时不可用'
}

export async function sendWordChatMessage(
  wordId: string,
  messages: WordChatMessage[],
  signal?: AbortSignal,
  provider?: AiProvider,
) {
  if (!supabase) throw new Error('尚未配置 Supabase')
  const accessToken = await getAccessToken()
  const { data, error } = await supabase.functions.invoke('word-chat', {
    body: { wordId, messages, provider },
    headers: { Authorization: `Bearer ${accessToken}` },
    signal,
  })
  if (error) throw new Error(await getFunctionErrorMessage(error))
  return parseWordChatResponse(data)
}
