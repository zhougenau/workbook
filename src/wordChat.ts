import { getAccessToken, supabase } from './supabase'

export type WordChatMessage = {
  role: 'user' | 'assistant'
  content: string
}

export type WordChatResponse = {
  reply: string
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
  return error.message || 'AI 对话暂时不可用'
}

export async function sendWordChatMessage(
  wordId: string,
  messages: WordChatMessage[],
  signal?: AbortSignal,
) {
  if (!supabase) throw new Error('尚未配置 Supabase')
  const accessToken = await getAccessToken()
  const { data, error } = await supabase.functions.invoke('word-chat', {
    body: { wordId, messages },
    headers: { Authorization: `Bearer ${accessToken}` },
    signal,
  })
  if (error) throw new Error(await getFunctionErrorMessage(error))
  if (
    !data ||
    typeof data.reply !== 'string' ||
    !data.reply.trim() ||
    !data.tokenUsage ||
    !Number.isInteger(data.tokenUsage.promptTokens) ||
    !Number.isInteger(data.tokenUsage.completionTokens) ||
    !Number.isInteger(data.tokenUsage.totalTokens)
  ) throw new Error('AI 返回了无法识别的对话内容')
  return data as WordChatResponse
}
