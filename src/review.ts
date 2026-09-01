import { supabase } from './supabase'

export type ReviewDifficulty = 'basic' | 'intermediate' | 'advanced'
export type ReviewQuestionType = 'meaning' | 'reverse' | 'cloze' | 'usage'

export type ReviewQuestion = {
  id: string
  type: ReviewQuestionType
  wordId: string
  word: string
  prompt: string
  options: [string, string, string, string]
  correctIndex: number
  explanation: string
}

export type ReviewQuiz = {
  title: string
  questions: ReviewQuestion[]
}

const questionTypes = new Set<ReviewQuestionType>(['meaning', 'reverse', 'cloze', 'usage'])

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

function parseReviewQuiz(value: unknown, expectedCount: number): ReviewQuiz {
  if (!value || typeof value !== 'object') throw new Error('AI 返回了无法识别的题目格式')
  const quiz = value as Record<string, unknown>
  if (typeof quiz.title !== 'string' || !Array.isArray(quiz.questions)) {
    throw new Error('AI 返回的题目不完整')
  }
  if (quiz.questions.length !== expectedCount || !quiz.questions.every(isQuestion)) {
    throw new Error(`AI 未能生成完整的 ${expectedCount} 道四选一题，请重试`)
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
) {
  if (!supabase) throw new Error('尚未配置 Supabase')

  const { data, error } = await supabase.functions.invoke('generate-review', {
    body: { wordIds, questionCount, difficulty },
  })
  if (error) throw new Error(await getFunctionErrorMessage(error))
  return parseReviewQuiz(data, questionCount)
}
