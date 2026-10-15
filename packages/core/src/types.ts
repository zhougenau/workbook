export type SyncStatus = 'local' | 'pending' | 'synced' | 'conflict'
export type ReviewDifficulty = 'basic' | 'intermediate' | 'advanced'
export type ReviewQuestionType = 'meaning' | 'reverse' | 'cloze' | 'usage'

export type VocabularyEntry = {
  id: string
  term: string
  meaning: string
  note: string
  mastery: number
  createdAt: string
  updatedAt: string
  ownerId?: string | null
  deletedAt: string | null
  syncStatus: SyncStatus
}

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
  tokenUsage: { promptTokens: number; completionTokens: number; totalTokens: number }
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