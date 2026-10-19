import type { AiProvider } from '@wordbook/core'
import { getAccessToken, supabase } from './supabase'

export async function completeWord(term: string, signal: AbortSignal, provider: AiProvider): Promise<{ meaning: string; example: string }> {
  if (!supabase) throw new Error('尚未配置 Supabase')
  const accessToken = await getAccessToken()
  signal.throwIfAborted()
  const { data, error } = await supabase.functions.invoke('complete-word', {
    body: { term, provider },
    headers: { Authorization: `Bearer ${accessToken}` },
    signal,
  })
  if (error) {
    if (error.context instanceof Response) {
      let body: unknown
      try {
        body = await error.context.clone().json()
      } catch {
        body = null
      }
      if (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string' && body.error.trim()) throw new Error(body.error)
    }
    throw new Error(error.message || 'AI 补全失败')
  }
  if (!data || typeof data.meaning !== 'string' || !data.meaning.trim() || typeof data.example !== 'string' || !data.example.trim()) throw new Error('AI 返回的补全内容不完整')
  return { meaning: data.meaning.trim(), example: data.example.trim() }
}