import type { MasteryChange, ReviewDifficulty, ReviewQuestionType, ReviewQuiz, VocabularyEntry } from './types'

const difficultyWeights: Record<ReviewDifficulty, number> = { basic: 1, intermediate: 1.15, advanced: 1.3 }
const questionWeights: Record<ReviewQuestionType, number> = { meaning: 1, reverse: 1.1, cloze: 1.25, usage: 1.4 }

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