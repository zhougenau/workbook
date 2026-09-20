import { getAccessToken, supabase } from './supabase'

export type Flashcard = {
  wordId: string
  word: string
  meaning: string
  usage: string
  synonyms: string[]
  antonyms: string[]
  memoryTip: string
}

export type GeneratedFlashcards = {
  cards: Flashcard[]
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
  return error.message || 'AI 卡片生成失败'
}

function parseFlashcards(value: unknown): GeneratedFlashcards {
  if (!value || typeof value !== 'object') throw new Error('AI 返回了无法识别的卡片格式')
  const result = value as Record<string, unknown>
  const usage = result.tokenUsage as Record<string, unknown> | undefined
  const cards = result.cards
  if (
    !Array.isArray(cards) || !cards.length ||
    !cards.every((card) => {
      if (!card || typeof card !== 'object') return false
      const item = card as Record<string, unknown>
      return typeof item.wordId === 'string' && item.wordId.trim() &&
        typeof item.word === 'string' && item.word.trim() &&
        typeof item.meaning === 'string' && item.meaning.trim() &&
        typeof item.usage === 'string' && item.usage.trim() &&
        Array.isArray(item.synonyms) && item.synonyms.every((word) => typeof word === 'string' && word.trim()) &&
        Array.isArray(item.antonyms) && item.antonyms.every((word) => typeof word === 'string' && word.trim()) &&
        typeof item.memoryTip === 'string' && item.memoryTip.trim()
    }) ||
    !usage ||
    !Number.isInteger(usage.promptTokens) ||
    !Number.isInteger(usage.completionTokens) ||
    !Number.isInteger(usage.totalTokens)
  ) throw new Error('AI 返回的卡片内容不完整')
  return result as GeneratedFlashcards
}

export async function generateFlashcards(wordIds: string[], signal?: AbortSignal) {
  if (!supabase) throw new Error('尚未配置 Supabase')
  const accessToken = await getAccessToken()
  const { data, error } = await supabase.functions.invoke('generate-flashcards', {
    body: { wordIds },
    headers: { Authorization: `Bearer ${accessToken}` },
    signal,
  })
  if (error) throw new Error(await getFunctionErrorMessage(error))
  return parseFlashcards(data)
}
