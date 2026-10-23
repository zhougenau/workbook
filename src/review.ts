import type { AiProvider } from '@wordbook/core'
import { getAccessToken, supabase } from './supabase'
import { notifyPaidUsageChanged } from './paidUsage'
import type { ReviewDifficulty, ReviewMode, ReviewQuestion, ReviewQuestionType, ReviewQuiz } from '@wordbook/core'

export { calculateMasteryChanges } from '@wordbook/core'
export type { MasteryChange, ReviewDifficulty, ReviewMode, ReviewQuiz } from '@wordbook/core'

const questionTypes = new Set<ReviewQuestionType>(['meaning', 'reverse', 'cloze', 'usage', 'scenario', 'collocation'])

function isQuestion(value: unknown): value is ReviewQuestion {
  if (!value || typeof value !== 'object') return false
  const question = value as Record<string, unknown>
  return (
    typeof question.id === 'string' &&
    questionTypes.has(question.type as ReviewQuestionType) &&
    typeof question.wordId === 'string' &&
    typeof question.word === 'string' &&
    typeof question.prompt === 'string' &&
    Array.isArray(question.options) &&
    question.options.length === 4 &&
    question.options.every((option) => typeof option === 'string' && option.trim()) &&
    Number.isInteger(question.correctIndex) &&
    Number(question.correctIndex) >= 0 &&
    Number(question.correctIndex) <= 3 &&
    typeof question.explanation === 'string'
  )
}

function parseReviewQuiz(value: unknown, expectedCount: number, mode: ReviewMode): ReviewQuiz {
  if (!value || typeof value !== 'object') throw new Error('AI 返回了无法识别的题目格式')
  const quiz = value as Record<string, unknown>
  if (typeof quiz.title !== 'string' || !Array.isArray(quiz.questions)) {
    throw new Error('AI 返回的题目不完整')
  }
  if (quiz.questions.length !== expectedCount || !quiz.questions.every(isQuestion)) {
    throw new Error(`AI 未能生成完整的 ${expectedCount} 道四选一题，请重试`)
  }
  if (mode === 'context' && (!quiz.questions.every((question) => question.type === 'scenario' || question.type === 'collocation') ||
    !quiz.questions.some((question) => question.type === 'scenario') || !quiz.questions.some((question) => question.type === 'collocation'))) {
    throw new Error('AI 未能生成完整的语境题，请重试')
  }
  const tokenUsage = quiz.tokenUsage as Record<string, unknown> | undefined
  if (
    !tokenUsage ||
    !Number.isInteger(tokenUsage.promptTokens) || Number(tokenUsage.promptTokens) < 0 ||
    !Number.isInteger(tokenUsage.completionTokens) || Number(tokenUsage.completionTokens) < 0 ||
    !Number.isInteger(tokenUsage.totalTokens) || Number(tokenUsage.totalTokens) < 0
  ) {
    throw new Error('AI 返回的 Token 用量格式不正确')
  }
  return quiz as ReviewQuiz
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
  return error.message || 'AI 复习题生成失败'
}

export async function generateReview(
  wordIds: string[],
  questionCount: number,
  difficulty: ReviewDifficulty,
  signal?: AbortSignal,
  provider?: AiProvider,
  mode: ReviewMode = 'standard',
) {
  if (!supabase) throw new Error('尚未配置 Supabase')
  const accessToken = await getAccessToken()

  const { data, error } = await supabase.functions.invoke('generate-review', {
    body: { wordIds, questionCount, difficulty, provider, mode },
    headers: { Authorization: `Bearer ${accessToken}` },
    signal,
  })
  if (!signal?.aborted) notifyPaidUsageChanged()
  if (error) throw new Error(await getFunctionErrorMessage(error))
  return parseReviewQuiz(data, questionCount, mode)
}
