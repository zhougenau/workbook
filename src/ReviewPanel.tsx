import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { ArrowRight, BrainCircuit, Check, LoaderCircle, RotateCcw, X } from 'lucide-react'
import { calculateMasteryChanges, generateReview, type MasteryChange, type ReviewDifficulty, type ReviewQuiz } from './review'
import type { VocabularyEntry } from './storage'

type ReviewPanelProps = {
  selectedWords: VocabularyEntry[]
  prepareWords: () => Promise<Record<string, string>>
  applyMasteryChanges: (changes: MasteryChange[]) => Promise<void>
  onClose: () => void
  autoStart?: boolean
}

const difficultyLabels: Record<ReviewDifficulty, string> = {
  basic: '基础',
  intermediate: '进阶',
  advanced: '挑战',
}

function TokenUsage({ quiz }: { quiz: ReviewQuiz }) {
  return (
    <dl className="review-token-usage" aria-label="本次 AI Token 用量">
      <div><dt>输入</dt><dd>{quiz.tokenUsage.promptTokens.toLocaleString()}</dd></div>
      <div><dt>输出</dt><dd>{quiz.tokenUsage.completionTokens.toLocaleString()}</dd></div>
      <div><dt>总计</dt><dd>{quiz.tokenUsage.totalTokens.toLocaleString()} Tokens</dd></div>
    </dl>
  )
}

export function ReviewPanel({ selectedWords, prepareWords, applyMasteryChanges, onClose, autoStart = false }: ReviewPanelProps) {
  const [questionCount, setQuestionCount] = useState(5)
  const [difficulty, setDifficulty] = useState<ReviewDifficulty>('basic')
  const [quiz, setQuiz] = useState<ReviewQuiz | null>(null)
  const [currentIndex, setCurrentIndex] = useState(0)
  const [answers, setAnswers] = useState<Record<number, number>>({})
  const [completed, setCompleted] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [masteryApplied, setMasteryApplied] = useState(false)
  const [applyingMastery, setApplyingMastery] = useState(false)
  const [masteryChanges, setMasteryChanges] = useState<MasteryChange[]>([])
  const [quizWords, setQuizWords] = useState<VocabularyEntry[]>(selectedWords)
  const autoStartRequested = useRef(false)
  const activeRequest = useRef<AbortController | null>(null)

  const createQuiz = async (reviewWordIds?: string[]) => {
    if ((!selectedWords.length && !reviewWordIds?.length) || loading) return
    activeRequest.current?.abort()
    const request = new AbortController()
    activeRequest.current = request
    setLoading(true)
    setError('')
    try {
      const idRemap = await prepareWords()
      request.signal.throwIfAborted()
      const canonicalWords = selectedWords.map((word) => ({
        ...word,
        id: idRemap[word.id] ?? word.id,
      }))
      const wordIds = reviewWordIds ?? canonicalWords
        .map((word) => word.id)
        .sort(() => Math.random() - 0.5)
        .slice(0, 20)
      const result = await generateReview(wordIds, questionCount, difficulty, request.signal)
      setQuizWords(canonicalWords)
      setQuiz(result)
      setCurrentIndex(0)
      setAnswers({})
      setCompleted(false)
      setMasteryApplied(false)
      setMasteryChanges([])
    } catch (cause) {
      if (request.signal.aborted) return
      setError(cause instanceof Error ? cause.message : 'AI 复习题生成失败')
    } finally {
      if (activeRequest.current === request) {
        activeRequest.current = null
        setLoading(false)
      }
    }
  }

  const startAutomaticQuiz = useEffectEvent(() => {
    void createQuiz()
  })

  useEffect(() => {
    if (!autoStart || autoStartRequested.current) return
    autoStartRequested.current = true
    startAutomaticQuiz()
  }, [autoStart])

  useEffect(() => () => activeRequest.current?.abort(), [])

  const restart = () => {
    setCurrentIndex(0)
    setAnswers({})
    setCompleted(false)
  }

  if (!quiz) {
    return (
      <section id="review-panel" className="review-panel" aria-labelledby="review-panel-title">
        <div className="review-panel-heading">
          <div>
            <span className="review-kicker"><BrainCircuit size={16} />DEEPSEEK AI REVIEW</span>
            <h3 id="review-panel-title">生成选择题</h3>
            <p>已选择 {selectedWords.length} 个单词，AI 将生成 5–10 道四选一题{selectedWords.length > 20 ? '，本轮随机抽取 20 个词' : ''}。</p>
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
  const changedMastery = masteryChanges.filter((change) => change.nextLevel !== change.previousLevel)
  const incorrectWordIds = [...new Set(quiz.questions
    .filter((question, index) => answers[index] !== question.correctIndex)
    .map((question) => question.wordId))]

  const saveMasteryChanges = async (changes: MasteryChange[]) => {
    if (masteryApplied || applyingMastery || !changes.length) return
    setApplyingMastery(true)
    setError('')
    try {
      await applyMasteryChanges(changes)
      setMasteryApplied(true)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '掌握程度保存失败')
    } finally {
      setApplyingMastery(false)
    }
  }

  const finishReview = () => {
    if (masteryApplied) {
      setCompleted(true)
      return
    }
    const changes = calculateMasteryChanges(quiz, answers, quizWords, difficulty)
    const changed = changes.filter((change) => change.nextLevel !== change.previousLevel)
    setMasteryChanges(changes)
    setCompleted(true)
    if (changed.length) void saveMasteryChanges(changed)
  }

  if (completed) {
    return (
      <section id="review-panel" className="review-panel review-result" aria-live="polite">
        <span className="review-kicker"><Check size={16} />REVIEW COMPLETE</span>
        <strong>{score}<small> / {quiz.questions.length}</small></strong>
        <h3>{score === quiz.questions.length ? '全部答对' : '本轮复习完成'}</h3>
        <p>正确率 {Math.round((score / quiz.questions.length) * 100)}%。可以再答一次，或重新选择单词生成新题。</p>
        <TokenUsage quiz={quiz} />
        <div className="mastery-review" aria-label="掌握程度变化">
          <div className="mastery-review-heading">
            <strong>掌握程度变化</strong>
            <span>每轮自动调整最多 1 级</span>
          </div>
          <ul>
            {masteryChanges.map((change) => (
              <li key={change.wordId}>
                <span><b>{change.term}</b><small>{change.correctCount}/{change.questionCount} 题正确 · 证据 {change.evidence > 0 ? '+' : ''}{change.evidence}</small></span>
                <strong className={change.nextLevel > change.previousLevel ? 'up' : change.nextLevel < change.previousLevel ? 'down' : ''}>
                  {change.previousLevel} → {change.nextLevel}
                </strong>
              </li>
            ))}
          </ul>
          {masteryApplied ? (
            <p className="mastery-saved"><Check size={15} />已保存并等待云同步</p>
          ) : changedMastery.length ? (
            <button className="apply-mastery-button" type="button" onClick={() => void saveMasteryChanges(changedMastery)} disabled={applyingMastery}>
              {applyingMastery ? <LoaderCircle className="spin" size={17} /> : <Check size={17} />}
              {applyingMastery ? '正在自动保存…' : `重试保存 ${changedMastery.length} 个调整`}
            </button>
          ) : (
            <p className="mastery-unchanged">本轮证据不足，掌握程度保持不变</p>
          )}
          {error && <p className="review-error" role="alert">{error}</p>}
        </div>
        <div className="review-result-actions">
          <button type="button" onClick={restart}><RotateCcw size={17} />再答一次</button>
          {!!incorrectWordIds.length && (
            <button className="reinforce-review-button" type="button" onClick={() => void createQuiz(incorrectWordIds)} disabled={loading}>
              {loading ? <LoaderCircle className="spin" size={17} /> : <BrainCircuit size={17} />}
              {loading ? '正在生成…' : `强化复习 ${incorrectWordIds.length} 个错词`}
            </button>
          )}
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
    <section id="review-panel" className="review-panel review-quiz" aria-labelledby="review-question-title" aria-live="polite">
      <div className="review-progress">
        <span>{quiz.title}</span>
        <strong>{currentIndex + 1} / {quiz.questions.length}</strong>
      </div>
      <TokenUsage quiz={quiz} />
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
          onClick={() => currentIndex === quiz.questions.length - 1 ? finishReview() : setCurrentIndex((index) => index + 1)}
        >
          {currentIndex === quiz.questions.length - 1 ? '查看结果' : '下一题'}<ArrowRight size={17} />
        </button>
      </div>
    </section>
  )
}
