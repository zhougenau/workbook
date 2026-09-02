import { type FormEvent, useEffect, useEffectEvent, useRef, useState } from 'react'
import { LoaderCircle, MessageCircle, Send, Sparkles, X } from 'lucide-react'
import type { VocabularyEntry } from './storage'
import { sendWordChatMessage, type WordChatMessage } from './wordChat'

type WordChatDialogProps = {
  word: VocabularyEntry
  prepareWord: (id: string) => Promise<string>
  onClose: () => void
}

const suggestions = [
  '帮我拆解词根和记忆方法',
  '给我三个不同场景的例句',
  '这个词和哪些近义词容易混淆？',
]

export function WordChatDialog({ word, prepareWord, onClose }: WordChatDialogProps) {
  const [messages, setMessages] = useState<WordChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [canonicalWordId, setCanonicalWordId] = useState<string | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const messagesEnd = useRef<HTMLDivElement | null>(null)
  const activeRequest = useRef<AbortController | null>(null)
  const closeDialog = useEffectEvent(onClose)

  useEffect(() => {
    inputRef.current?.focus()
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeDialog()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      activeRequest.current?.abort()
    }
  }, [])

  useEffect(() => {
    messagesEnd.current?.scrollIntoView({ block: 'nearest' })
  }, [messages, loading])

  const ask = async (question: string) => {
    const cleanQuestion = question.trim()
    if (!cleanQuestion || loading) return

    const userMessage: WordChatMessage = { role: 'user', content: cleanQuestion }
    const nextMessages = [...messages, userMessage].slice(-12)
    setMessages(nextMessages)
    setInput('')
    setError('')
    setLoading(true)

    const request = new AbortController()
    activeRequest.current?.abort()
    activeRequest.current = request
    try {
      const wordId = canonicalWordId ?? await prepareWord(word.id)
      request.signal.throwIfAborted()
      setCanonicalWordId(wordId)
      const result = await sendWordChatMessage(wordId, nextMessages, request.signal)
      const assistantMessage: WordChatMessage = { role: 'assistant', content: result.reply }
      setMessages((current) => [...current, assistantMessage].slice(-12))
    } catch (cause) {
      if (!request.signal.aborted) {
        setError(cause instanceof Error ? cause.message : 'AI 对话暂时不可用')
      }
    } finally {
      if (activeRequest.current === request) {
        activeRequest.current = null
        setLoading(false)
      }
    }
  }

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void ask(input)
  }

  return (
    <div className="word-chat-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section className="word-chat-dialog" role="dialog" aria-modal="true" aria-labelledby="word-chat-title">
        <header className="word-chat-header">
          <div>
            <span><MessageCircle size={16} />AI WORD COACH</span>
            <h2 id="word-chat-title">和 AI 学习 {word.term}</h2>
            <p>{word.meaning || '围绕这个单词提问，获得释义、例句和记忆建议。'}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭 AI 对话" title="关闭"><X size={19} /></button>
        </header>

        <div className="word-chat-messages" aria-live="polite" aria-label={`${word.term} 的 AI 对话记录`}>
          {!messages.length && (
            <div className="word-chat-welcome">
              <Sparkles size={24} />
              <p>可以问我这个词的含义、用法、词源、近义词区别，或请我制定记忆方案。</p>
              <div className="word-chat-suggestions">
                {suggestions.map((suggestion) => (
                  <button key={suggestion} type="button" onClick={() => void ask(suggestion)}>{suggestion}</button>
                ))}
              </div>
            </div>
          )}
          {messages.map((message, index) => (
            <div className={`word-chat-message ${message.role}`} key={`${message.role}-${index}`}>
              <span>{message.role === 'user' ? '你' : 'AI'}</span>
              <p>{message.content}</p>
            </div>
          ))}
          {loading && <div className="word-chat-thinking"><LoaderCircle className="spin" size={17} />AI 正在整理学习建议…</div>}
          {error && <p className="word-chat-error" role="alert">{error}</p>}
          <div ref={messagesEnd} />
        </div>

        <form className="word-chat-form" onSubmit={submit}>
          <textarea
            ref={inputRef}
            value={input}
            onChange={(event) => setInput(event.target.value.slice(0, 1000))}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                if (input.trim()) void ask(input)
              }
            }}
            placeholder={`询问关于 ${word.term} 的问题…`}
            aria-label={`询问关于 ${word.term} 的问题`}
            rows={2}
          />
          <button type="submit" disabled={!input.trim() || loading} aria-label="发送问题"><Send size={18} /></button>
          <small>{input.length}/1000 · Enter 发送，Shift + Enter 换行</small>
        </form>
      </section>
    </div>
  )
}
