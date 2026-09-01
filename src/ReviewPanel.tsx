import { useState } from 'react'
import { ArrowRight, BrainCircuit, Check, LoaderCircle, RotateCcw, X } from 'lucide-react'
import { generateReview, type ReviewDifficulty, type ReviewQuiz } from './review'
import type { VocabularyEntry } from './storage'

type ReviewPanelProps = {
  selectedWords: VocabularyEntry[]
  prepareWords: () => Promise<void>
  onClose: () => void
}

const difficultyLabels: Record<ReviewDifficulty, string> = {
  basic: '基础',
  intermediate: '进阶',
  advanced: '挑战',
}

export function ReviewPanel({ selectedWords, prepareWords, onClose }: ReviewPanelProps) {
  const [questionCount, setQuestionCount] = useState(5)
  const [difficulty, setDifficulty] = useState<ReviewDifficulty>('basic')
  const [quiz, setQuiz] = useState<ReviewQuiz | null>(null)
  const [currentIndex, setCurrentIndex] = useState(0)
  const [answers, setAnswers] = useState<Record<number, number>>({})
  const [completed, setCompleted] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const createQuiz = async () => {
    if (!selectedWords.length || loading) return
    setLoading(true)
    setError('')
    try {
      await prepareWords()
      const result = await generateReview(selectedWords.map((word) => word.id), questionCount, difficulty)
      setQuiz(result)
      setCurrentIndex(0)
      setAnswers({})
      setCompleted(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'AI 复习题生成失败')
    } finally {
      setLoading(false)
    }
  }

  const restart = () => {
    setCurrentIndex(0)
    setAnswers({})
    setCompleted(false)
  }

  if (!quiz) {
    return (
      <section className="review-panel" aria-labelledby="review-panel-title">
        <div className="review-panel-heading">
          <div>
            <span className="review-kicker"><BrainCircuit size={16} />DEEPSEEK AI REVIEW</span>
            <h3 id="review-panel-title">生成选择题</h3>
            <p>已选择 {selectedWords.length} 个单词，AI 将生成 5–10 道四选一题。</p>
          </div>
          <button className="review-close" type="button" onClick={onClose} title="退出复习选择" aria-label="退出复习选择"><X size={18} /></button>
        </div>
        <div className="review-settings">
          <label>
            <span>题目数量</span>
            <select value={questionCount} onChange={(event) => setQuestionCount(Number(event.target.value))}>
              {[5, 6, 7, 8, 9, 10].map((count) => <option key={count} value={count}>{count} 题</option>)}
            </select>
          </label>
          <label>
            <span>难度</span>
            <select value={difficulty} onChange={(event) => setDifficulty(event.target.value as ReviewDifficulty)}>
              {Object.entries(difficultyLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <button className="generate-review-button" type="button" onClick={() => void createQuiz()} disabled={!selectedWords.length || loading}>
            {loading ? <LoaderCircle className="spin" size={18} /> : <BrainCircuit size={18} />}
            {loading ? '正在生成…' : 'AI 生成题目'}
          </button>
        </div>
        {!selectedWords.length && <p className="review-hint">请先勾选至少一个单词。</p>}
        {error && <p className="review-error" role="alert">{error}</p>}
      </section>
    )
  }

  const score = quiz.questions.reduce(
    (total, question, index) => total + (answers[index] === question.correctIndex ? 1 : 0),
    0,
  )

  if (completed) {
    return (
      <section className="review-panel review-result" aria-live="polite">
        <span className="review-kicker"><Check size={16} />REVIEW COMPLETE</span>
        <strong>{score}<small> / {quiz.questions.length}</small></strong>
        <h3>{score === quiz.questions.length ? '全部答对' : '本轮复习完成'}</h3>
        <p>正确率 {Math.round((score / quiz.questions.length) * 100)}%。可以再答一次，或重新选择单词生成新题。</p>
        <div className="review-result-actions">
          <button type="button" onClick={restart}><RotateCcw size={17} />再答一次</button>
          <button type="button" onClick={() => setQuiz(null)}><BrainCircuit size={17} />重新生成</button>
          <button type="button" onClick={onClose}>完成</button>
        </div>
      </section>
    )
  }

  const question = quiz.questions[currentIndex]
  const selectedAnswer = answers[currentIndex]
  const answered = selectedAnswer !== undefined

  return (
    <section className="review-panel review-quiz" aria-labelledby="review-question-title">
      <div className="review-progress">
        <span>{quiz.title}</span>
        <strong>{currentIndex + 1} / {quiz.questions.length}</strong>
      </div>
      <div className="review-progress-track"><span style={{ width: `${((currentIndex + 1) / quiz.questions.length) * 100}%` }} /></div>
      <span className="review-question-type">{question.word} · {question.type}</span>
      <h3 id="review-question-title">{question.prompt}</h3>
      <div className="review-options">
        {question.options.map((option, index) => {
          const state = answered
            ? index === question.correctIndex ? 'correct' : index === selectedAnswer ? 'wrong' : ''
            : ''
          return (
            <button
              key={`${question.id}-${option}`}
              className={state}
              type="button"
              onClick={() => setAnswers((current) => ({ ...current, [currentIndex]: index }))}
              disabled={answered}
            >
              <span>{String.fromCharCode(65 + index)}</span>{option}
            </button>
          )
        })}
      </div>
      {answered && (
        <div className={`review-explanation ${selectedAnswer === question.correctIndex ? 'correct' : 'wrong'}`}>
          <strong>{selectedAnswer === question.correctIndex ? '回答正确' : `正确答案：${question.options[question.correctIndex]}`}</strong>
          <p>{question.explanation}</p>
        </div>
      )}
      <div className="review-question-actions">
        <button type="button" onClick={onClose}>退出复习</button>
        <button
          className="review-next"
          type="button"
          disabled={!answered}
          onClick={() => currentIndex === quiz.questions.length - 1 ? setCompleted(true) : setCurrentIndex((index) => index + 1)}
        >
          {currentIndex === quiz.questions.length - 1 ? '查看结果' : '下一题'}<ArrowRight size={17} />
        </button>
      </div>
    </section>
  )
}
