import { supabase } from './supabase'
import type { VocabularyEntry } from './storage'

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
  tokenUsage: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
}

export type MasteryChange = {
  wordId: string
  term: string
  previousLevel: number
  nextLevel: number
  evidence: number
  correctCount: number
  questionCount: number
}

const difficultyWeights: Record<ReviewDifficulty, number> = {
  basic: 1,
  intermediate: 1.15,
  advanced: 1.3,
}

const questionWeights: Record<ReviewQuestionType, number> = {
  meaning: 1,
  reverse: 1.1,
  cloze: 1.25,
  usage: 1.4,
}

export function calculateMasteryChanges(
  quiz: ReviewQuiz,
  answers: Record<number, number>,
  words: VocabularyEntry[],
  difficulty: ReviewDifficulty,
): MasteryChange[] {
  const evidenceByWord = new Map<string, { evidence: number; correctCount: number; questionCount: number }>()

  quiz.questions.forEach((question, index) => {
    if (answers[index] === undefined) return
    const result = evidenceByWord.get(question.wordId) ?? { evidence: 0, correctCount: 0, questionCount: 0 }
    const weight = difficultyWeights[difficulty] * questionWeights[question.type]
    const correct = answers[index] === question.correctIndex
    result.evidence += correct ? weight : -weight * 1.15
    result.correctCount += correct ? 1 : 0
    result.questionCount += 1
    evidenceByWord.set(question.wordId, result)
  })

  return words.flatMap((word) => {
    const result = evidenceByWord.get(word.id)
    if (!result) return []
    const delta = result.evidence >= 1.75 ? 1 : result.evidence <= -1.75 ? -1 : 0
    const nextLevel = Math.max(0, Math.min(5, word.mastery + delta))
    return [{
      wordId: word.id,
      term: word.term,
      previousLevel: word.mastery,
      nextLevel,
      evidence: Math.round(result.evidence * 100) / 100,
      correctCount: result.correctCount,
      questionCount: result.questionCount,
    }]
  })
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
) {
  if (!supabase) throw new Error('尚未配置 Supabase')

  const { data, error } = await supabase.functions.invoke('generate-review', {
    body: { wordIds, questionCount, difficulty },
  })
  if (error) throw new Error(await getFunctionErrorMessage(error))
  return parseReviewQuiz(data, questionCount)
}
