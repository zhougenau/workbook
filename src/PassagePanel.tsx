import { useEffect, useRef, useState, type ReactNode } from 'react'
import { BookText, Check, LoaderCircle, RotateCcw, Square, Volume2, X } from 'lucide-react'
import { generatePassage, type GeneratedPassage, type PassageLength } from './passage'
import type { VocabularyEntry } from './storage'

type PassagePanelProps = {
  selectedWords: VocabularyEntry[]
  prepareWords: () => Promise<Record<string, string>>
  onClose: () => void
}

const lengthOptions: Array<{ value: PassageLength; label: string; detail: string }> = [
  { value: 'short', label: '短篇', detail: '约 100–200 词' },
  { value: 'medium', label: '中篇', detail: '约 200–300 词' },
  { value: 'long', label: '长篇', detail: '约 500 词' },
]

function defaultLength(wordCount: number): PassageLength {
  if (wordCount > 20) return 'long'
  if (wordCount > 10) return 'medium'
  return 'short'
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function highlightWords(passage: string, words: string[]) {
  const uniqueWords = [...new Map(words.map((word) => word.trim()).filter(Boolean)
    .map((word) => [word.toLowerCase(), word])).values()]
    .sort((left, right) => right.length - left.length)
  if (!uniqueWords.length) return passage

  const matcher = new RegExp(`(^|[^\\p{L}\\p{M}\\p{N}])(${uniqueWords.map(escapeRegExp).join('|')})(?![\\p{L}\\p{M}\\p{N}])`, 'giu')
  const parts: ReactNode[] = []
  let cursor = 0

  for (const match of passage.matchAll(matcher)) {
    const wordStart = match.index + match[1].length
    parts.push(passage.slice(cursor, wordStart))
    parts.push(<strong className="passage-target-word" key={wordStart}>{match[2]}</strong>)
    cursor = wordStart + match[2].length
  }

  parts.push(passage.slice(cursor))
  return parts
}

export function PassagePanel({ selectedWords, prepareWords, onClose }: PassagePanelProps) {
  const [chosenLength, setChosenLength] = useState<PassageLength | null>(null)
  const [result, setResult] = useState<GeneratedPassage | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [isSpeaking, setIsSpeaking] = useState(false)
  const activeRequest = useRef<AbortController | null>(null)
  const activeUtterance = useRef<SpeechSynthesisUtterance | null>(null)

  useEffect(() => () => {
    activeRequest.current?.abort()
    window.speechSynthesis?.cancel()
  }, [])

  const length = chosenLength ?? defaultLength(selectedWords.length)

  const stopReading = () => {
    window.speechSynthesis?.cancel()
    activeUtterance.current = null
    setIsSpeaking(false)
  }

  const toggleReading = () => {
    if (isSpeaking) {
      stopReading()
      return
    }
    if (!result || !Reflect.has(window, 'speechSynthesis')) {
      window.alert('当前浏览器不支持语音朗读')
      return
    }

    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(`${result.title}. ${result.passage}`)
    utterance.lang = 'en-US'
    utterance.rate = 0.85
    utterance.onend = () => {
      if (activeUtterance.current === utterance) {
        activeUtterance.current = null
        setIsSpeaking(false)
      }
    }
    utterance.onerror = utterance.onend
    activeUtterance.current = utterance
    setIsSpeaking(true)
    window.speechSynthesis.speak(utterance)
  }

  const createPassage = async () => {
    if (!selectedWords.length || loading) return
    stopReading()
    activeRequest.current?.abort()
    const request = new AbortController()
    activeRequest.current = request
    setLoading(true)
    setError('')
    try {
      const idRemap = await prepareWords()
      request.signal.throwIfAborted()
      const wordIds = selectedWords.map((word) => idRemap[word.id] ?? word.id)
      setResult(await generatePassage(wordIds, length, request.signal))
    } catch (cause) {
      if (!request.signal.aborted) setError(cause instanceof Error ? cause.message : 'AI 短文生成失败')
    } finally {
      if (activeRequest.current === request) {
        activeRequest.current = null
        setLoading(false)
      }
    }
  }

  return (
    <section id="passage-panel" className="review-panel passage-panel" aria-labelledby="passage-panel-title">
      <div className="review-panel-heading">
        <div>
          <span className="review-kicker"><BookText size={16} />DEEPSEEK AI PASSAGE</span>
          <h3 id="passage-panel-title">用所选单词生成短文</h3>
          <p>已选择 {selectedWords.length} 个单词。AI 会将每个词自然地写入同一篇英文短文。</p>
        </div>
        <button className="review-close" type="button" onClick={() => { stopReading(); onClose() }} title="退出短文选择" aria-label="退出短文选择"><X size={18} /></button>
      </div>

      <div className="passage-settings" role="group" aria-label="短文长度">
        {lengthOptions.map((option) => (
          <button
            key={option.value}
            type="button"
            className={length === option.value ? 'active' : ''}
            aria-pressed={length === option.value}
            onClick={() => setChosenLength(option.value)}
          >
            <strong>{option.label}</strong>
            <span>{option.detail}</span>
          </button>
        ))}
        <button className="generate-review-button" type="button" onClick={() => void createPassage()} disabled={!selectedWords.length || loading}>
          {loading ? <LoaderCircle className="spin" size={18} /> : result ? <RotateCcw size={18} /> : <BookText size={18} />}
          {loading ? '正在创作…' : result ? '重新生成' : 'AI 生成短文'}
        </button>
      </div>

      {!selectedWords.length && <p className="review-hint">请先勾选至少一个单词。</p>}
      {error && <p className="review-error" role="alert">{error}</p>}

      {result && (
        <article className="passage-result" aria-live="polite">
          <div className="passage-result-heading">
            <div>
              <span>ENGLISH PASSAGE</span>
              <h4>{result.title}</h4>
            </div>
            <div className="passage-result-actions">
              <button className={isSpeaking ? 'passage-speak-button active' : 'passage-speak-button'} type="button" onClick={toggleReading} aria-pressed={isSpeaking} title={isSpeaking ? '停止朗读' : '朗读英文短文'}>
                {isSpeaking ? <Square size={15} fill="currentColor" /> : <Volume2 size={17} />}
                {isSpeaking ? '停止' : '朗读'}
              </button>
              <dl className="review-token-usage" aria-label="本次 AI Token 用量">
                <div><dt>输入</dt><dd>{result.tokenUsage.promptTokens.toLocaleString()}</dd></div>
                <div><dt>输出</dt><dd>{result.tokenUsage.completionTokens.toLocaleString()}</dd></div>
                <div><dt>总计</dt><dd>{result.tokenUsage.totalTokens.toLocaleString()}</dd></div>
              </dl>
            </div>
          </div>
          <p className="passage-copy">{highlightWords(result.passage, result.usedWords)}</p>
          <div className="passage-translation">
            <strong>参考译文</strong>
            <p>{result.translation}</p>
          </div>
          <div className="passage-used-words">
            <span><Check size={15} />已覆盖 {result.usedWords.length} 个目标词</span>
            <div>{result.usedWords.map((word) => <b key={word}>{word}</b>)}</div>
          </div>
        </article>
      )}
    </section>
  )
}
