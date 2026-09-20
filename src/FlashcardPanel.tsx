import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Layers3, LoaderCircle, RotateCcw, Volume2, X } from 'lucide-react'
import { generateFlashcards, type Flashcard, type GeneratedFlashcards } from './flashcards'
import type { VocabularyEntry } from './storage'

type FlashcardPanelProps = {
  allWords: VocabularyEntry[]
  selectedWords: VocabularyEntry[]
  prepareWords: () => Promise<Record<string, string>>
  onClose: () => void
}

function randomSample(words: VocabularyEntry[], count: number) {
  const shuffled = [...words]
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.random() * (index + 1))
    const current = shuffled[index]
    shuffled[index] = shuffled[target]
    shuffled[target] = current
  }
  return shuffled.slice(0, count)
}

function readFlashcard(card: Flashcard, showUnsupportedMessage = false) {
  if (!Reflect.has(window, 'speechSynthesis')) {
    if (showUnsupportedMessage) window.alert('当前浏览器不支持语音朗读')
    return
  }
  window.speechSynthesis.cancel()
  const utterance = new SpeechSynthesisUtterance(`${card.word}. ${card.usage}`)
  utterance.lang = 'en-US'
  utterance.rate = 0.85
  window.speechSynthesis.speak(utterance)
}

export function FlashcardPanel({ allWords, selectedWords, prepareWords, onClose }: FlashcardPanelProps) {
  const [result, setResult] = useState<GeneratedFlashcards | null>(null)
  const [activeIndex, setActiveIndex] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const activeRequest = useRef<AbortController | null>(null)

  useEffect(() => () => {
    activeRequest.current?.abort()
    window.speechSynthesis?.cancel()
  }, [])

  const createFlashcards = async () => {
    if (!allWords.length || loading) return
    activeRequest.current?.abort()
    const request = new AbortController()
    activeRequest.current = request
    setLoading(true)
    setError('')
    try {
      const sourceWords = selectedWords.length ? selectedWords : randomSample(allWords, 10)
      const idRemap = await prepareWords()
      request.signal.throwIfAborted()
      const wordIds = sourceWords.map((word) => idRemap[word.id] ?? word.id)
      setResult(await generateFlashcards(wordIds, request.signal))
      setActiveIndex(0)
    } catch (cause) {
      if (!request.signal.aborted) setError(cause instanceof Error ? cause.message : 'AI 卡片生成失败')
    } finally {
      if (activeRequest.current === request) {
        activeRequest.current = null
        setLoading(false)
      }
    }
  }

  const card = result?.cards[activeIndex]

  useEffect(() => {
    if (!card) return
    readFlashcard(card)
    return () => window.speechSynthesis?.cancel()
  }, [card])

  return (
    <section id="flashcard-panel" className="review-panel flashcard-panel" aria-labelledby="flashcard-panel-title">
      <div className="review-panel-heading">
        <div>
          <span className="review-kicker"><Layers3 size={16} />DEEPSEEK AI FLASHCARDS</span>
          <h3 id="flashcard-panel-title">用单词卡片集中学习</h3>
          <p>{selectedWords.length ? `将为已选择的 ${selectedWords.length} 个单词生成卡片。` : `未选择单词，将从单词本随机抽取 ${Math.min(10, allWords.length)} 个。`}</p>
        </div>
        <button className="review-close" type="button" onClick={onClose} title="退出卡片学习" aria-label="退出卡片学习"><X size={18} /></button>
      </div>

      <div className="flashcard-actions">
        <button className="generate-review-button" type="button" onClick={() => void createFlashcards()} disabled={loading || !allWords.length}>
          {loading ? <LoaderCircle className="spin" size={18} /> : result ? <RotateCcw size={18} /> : <Layers3 size={18} />}
          {loading ? '正在生成…' : result ? '重新生成' : selectedWords.length ? '生成所选卡片' : '随机生成 10 张'}
        </button>
      </div>

      {error && <p className="review-error" role="alert">{error}</p>}

      {result && card && (
        <div className="flashcard-study" aria-live="polite">
          <div className="flashcard-progress">
            <span>FLASHCARD</span>
            <strong>{activeIndex + 1} / {result.cards.length}</strong>
          </div>
          <article className="flashcard">
            <div className="flashcard-word-row">
              <h4>{card.word}</h4>
              <button type="button" onClick={() => readFlashcard(card, true)} title={`重新朗读 ${card.word} 和用法`} aria-label={`重新朗读 ${card.word} 和用法`}><Volume2 size={18} /></button>
            </div>
            <div><span>释义</span><p>{card.meaning}</p></div>
            <div><span>用法</span><p lang="en">{card.usage}</p></div>
            <div className="flashcard-supplement">
              <span>补充</span>
              <div className="flashcard-supplement-content">
                <dl>
                  <div><dt>同义词</dt><dd>{card.synonyms.length ? card.synonyms.map((word) => <b key={word}>{word}</b>) : '暂无常用同义词'}</dd></div>
                  <div><dt>反义词</dt><dd>{card.antonyms.length ? card.antonyms.map((word) => <b key={word}>{word}</b>) : '暂无常用反义词'}</dd></div>
                </dl>
                <p><strong>记忆方法</strong>{card.memoryTip}</p>
              </div>
            </div>
          </article>
          <div className="flashcard-navigation">
            <button type="button" onClick={() => setActiveIndex((index) => Math.max(0, index - 1))} disabled={activeIndex === 0}><ChevronLeft size={18} />上一张</button>
            <div>{result.cards.map((item, index) => <button key={item.wordId} type="button" className={index === activeIndex ? 'active' : ''} onClick={() => setActiveIndex(index)} aria-label={`查看第 ${index + 1} 张：${item.word}`} aria-pressed={index === activeIndex} />)}</div>
            <button type="button" onClick={() => setActiveIndex((index) => Math.min(result.cards.length - 1, index + 1))} disabled={activeIndex === result.cards.length - 1}>下一张<ChevronRight size={18} /></button>
          </div>
          <dl className="review-token-usage" aria-label="本次 AI Token 用量">
            <div><dt>输入</dt><dd>{result.tokenUsage.promptTokens.toLocaleString()}</dd></div>
            <div><dt>输出</dt><dd>{result.tokenUsage.completionTokens.toLocaleString()}</dd></div>
            <div><dt>总计</dt><dd>{result.tokenUsage.totalTokens.toLocaleString()}</dd></div>
          </dl>
        </div>
      )}
    </section>
  )
}
