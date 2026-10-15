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

export const WORD_CHAT_SUGGESTIONS = [
  '帮我拆解词根和记忆方法',
  '给我三个不同场景的例句',
  '这个词和哪些近义词容易混淆？',
]

export const MAX_WORD_CHAT_MESSAGES = 24
export const MAX_WORD_CHAT_MESSAGE_LENGTH = 2000

export function appendWordChatQuestion(messages: readonly WordChatMessage[], question: string): WordChatMessage[] {
  const content = question.trim()
  if (!content || content.length > MAX_WORD_CHAT_MESSAGE_LENGTH) throw new Error('对话内容不正确或超过长度限制')
  return [...messages, { role: 'user' as const, content }].slice(-MAX_WORD_CHAT_MESSAGES)
}

export function appendWordChatReply(messages: readonly WordChatMessage[], reply: string): WordChatMessage[] {
  return [...messages, { role: 'assistant' as const, content: reply }].slice(-MAX_WORD_CHAT_MESSAGES)
}

export function parseWordChatResponse(value: unknown): WordChatResponse {
  if (!value || typeof value !== 'object') throw new Error('AI 返回了无法识别的对话内容')
  const result = value as Record<string, unknown>
  const usage = result.tokenUsage as Record<string, unknown> | undefined
  if (
    typeof result.reply !== 'string' || !result.reply.trim() ||
    !usage ||
    !Number.isInteger(usage.promptTokens) ||
    !Number.isInteger(usage.completionTokens) ||
    !Number.isInteger(usage.totalTokens)
  ) throw new Error('AI 返回了无法识别的对话内容')
  return result as WordChatResponse
}