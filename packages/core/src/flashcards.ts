export interface Flashcard {
  wordId: string
  word: string
  meaning: string
  usage: string
  synonyms: string[]
  antonyms: string[]
  memoryTip: string
}

export interface GeneratedFlashcards {
  cards: Flashcard[]
  tokenUsage: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
}

type CacheWord = { id: string; term: string; meaning: string; note: string; updatedAt: string }

function cacheVersion(word: CacheWord) {
  return JSON.stringify([word.term, word.meaning, word.note, word.updatedAt])
}

export function cacheFlashcard(word: CacheWord, card: Flashcard) {
  return { version: cacheVersion(word), card }
}

export function readCachedFlashcard(word: CacheWord, value: unknown): Flashcard | null {
  if (!value || typeof value !== 'object') return null
  const cached = value as { version?: unknown; card?: unknown }
  if (cached.version !== cacheVersion(word)) return null
  try {
    const parsed = parseGeneratedFlashcards({ cards: [cached.card], tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } })
    return parsed.cards[0].wordId === word.id && parsed.cards[0].word === word.term ? parsed.cards[0] : null
  } catch {
    return null
  }
}

export function parseGeneratedFlashcards(value: unknown): GeneratedFlashcards {
  if (!value || typeof value !== 'object') throw new Error('AI 返回了无法识别的卡片格式')
  const result = value as Record<string, unknown>
  const usage = result.tokenUsage as Record<string, unknown> | undefined
  const cards = result.cards
  if (
    !Array.isArray(cards) || !cards.length ||
    !cards.every((card) => {
      if (!card || typeof card !== 'object') return false
      const item = card as Record<string, unknown>
      return typeof item.wordId === 'string' && Boolean(item.wordId.trim()) &&
        typeof item.word === 'string' && Boolean(item.word.trim()) &&
        typeof item.meaning === 'string' && Boolean(item.meaning.trim()) &&
        typeof item.usage === 'string' && Boolean(item.usage.trim()) &&
        Array.isArray(item.synonyms) && item.synonyms.every((word) => typeof word === 'string' && Boolean(word.trim())) &&
        Array.isArray(item.antonyms) && item.antonyms.every((word) => typeof word === 'string' && Boolean(word.trim())) &&
        typeof item.memoryTip === 'string' && Boolean(item.memoryTip.trim())
    }) ||
    !usage ||
    !Number.isInteger(usage.promptTokens) ||
    !Number.isInteger(usage.completionTokens) ||
    !Number.isInteger(usage.totalTokens)
  ) throw new Error('AI 返回的卡片内容不完整')
  return result as unknown as GeneratedFlashcards
}

export function selectFlashcardWords<T extends { id: string }>(
  allWords: readonly T[],
  selectedWordIds: readonly string[],
  randomLimit = 10,
  random: () => number = Math.random,
): T[] {
  const selected = new Set(selectedWordIds)
  if (selected.size) return allWords.filter((word) => selected.has(word.id))

  const shuffled = [...allWords]
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1))
    const current = shuffled[index]
    shuffled[index] = shuffled[target]
    shuffled[target] = current
  }
  const limit = Number.isFinite(randomLimit) && randomLimit > 0 ? Math.floor(randomLimit) : 10
  return shuffled.slice(0, limit)
}

export function clampFlashcardIndex(index: number, cardCount: number): number {
  const lastIndex = Math.max(0, Math.floor(cardCount) - 1)
  const requested = Number.isFinite(index) ? Math.floor(index) : 0
  return Math.max(0, Math.min(requested, lastIndex))
}
