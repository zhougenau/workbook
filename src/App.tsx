import { type ChangeEvent, type FormEvent, useEffect, useEffectEvent, useRef, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import {
  BookOpen,
  BrainCircuit,
  Check,
  CheckSquare2,
  ChevronDown,
  Clock3,
  Cloud,
  CloudOff,
  Download,
  Edit3,
  ExternalLink,
  LogIn,
  LogOut,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Sparkles,
  Trash2,
  Upload,
  Volume2,
  X,
} from 'lucide-react'
import {
  deleteEntries as deleteStoredEntries,
  deleteEntry as deleteStoredEntry,
  initializeStorage,
  loadEntries,
  parseBackup,
  saveEntries,
  saveEntry,
  type VocabularyEntry,
} from './storage'
import { isCloudConfigured, supabase } from './supabase'
import { synchronize } from './sync'
import { ReviewPanel } from './ReviewPanel'
import type { MasteryChange } from './review'
import './App.css'

const masteryLabels = ['未掌握', '刚认识', '有印象', '基本理解', '较熟练', '已掌握']

function normalizeTerm(value: string) {
  return value.trim().toLocaleLowerCase()
}

const dictionaryEngines = {
  merriamWebster: {
    label: 'Merriam-Webster',
    getUrl: (term: string) => `https://www.merriam-webster.com/dictionary/${encodeURIComponent(term)}`,
  },
  cambridge: {
    label: 'Cambridge',
    getUrl: (term: string) => `https://dictionary.cambridge.org/dictionary/english/${encodeURIComponent(term)}`,
  },
  bing: {
    label: 'Bing 词典',
    getUrl: (term: string) => `https://www.bing.com/dict/search?q=${encodeURIComponent(term)}`,
  },
  iciba: {
    label: '爱词霸 iciba',
    getUrl: (term: string) => `https://www.iciba.com/word?w=${encodeURIComponent(term)}`,
  },
} as const

type DictionaryEngine = keyof typeof dictionaryEngines
const dictionaryEngineStorageKey = 'wordbook:dictionary-engine'

function loadDictionaryEngine(): DictionaryEngine {
  const savedEngine = window.localStorage.getItem(dictionaryEngineStorageKey)
  return savedEngine && savedEngine in dictionaryEngines ? savedEngine as DictionaryEngine : 'merriamWebster'
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function formatCurrentDate(value: Date, compact = false) {
  return new Intl.DateTimeFormat('zh-CN', compact
    ? { month: '2-digit', day: '2-digit' }
    : { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' }
  ).format(value)
}

function formatCurrentTime(value: Date) {
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(value)
}

function extractChineseMeaning(value: string) {
  const normalized = value.replace(/\(([\u3400-\u9fff，、；：。！？\s]+)\)/gu, '（$1）')
  return normalized.match(/[\u3400-\u9fff（），、；：。！？]+/gu)?.join('') ?? ''
}

function analyzeVocabularyText(source: string) {
  const text = source.trim()
  if (!text) return null

  const exampleMarker = /(?:\*{0,2}(?:e\.?\s*g\.?|example|例句)\*{0,2})\s*[:：.]?\s*/i
  const markerMatch = exampleMarker.exec(text)
  const beforeExample = markerMatch ? text.slice(0, markerMatch.index).trim() : text
  const example = markerMatch ? text.slice(markerMatch.index + markerMatch[0].length).trim() : ''
  const lines = beforeExample.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const heading = lines[0] ?? ''
  const termMatch = heading.match(/^([A-Za-z][A-Za-z'’-]*(?:[ -][A-Za-z][A-Za-z'’-]*)*)\s*(?=(?:adj|adv|noun|verb|prep|pron|conj|interj|n|v)\b|$)/i)
  const term = (termMatch?.[1] ?? heading.match(/[A-Za-z][A-Za-z'’-]*/)?.[0] ?? '').trim()
  const headingRemainder = heading
    .slice(termMatch?.[0].length ?? term.length)
    .replace(/^(?:adj|adv|noun|verb|prep|pron|conj|interj|n|v)\.?\s*/i, '')
    .trim()
  const meaning = extractChineseMeaning([headingRemainder, ...lines.slice(1)]
    .join(' ')
    .replace(/^\/[^/\r\n]+\/\s*/, '')
    .replace(/^(?:adj|adv|noun|verb|prep|pron|conj|interj|n|v)\.?\s*/i, '')
    .trim())

  return { term, meaning, example }
}

function pronounce(text: string) {
  if (!Reflect.has(window, 'speechSynthesis')) {
    window.alert('当前浏览器不支持语音朗读')
    return
  }

  window.speechSynthesis.cancel()
  const utterance = new SpeechSynthesisUtterance(text)
  utterance.lang = /[\u3400-\u9fff]/u.test(text) ? 'zh-CN' : 'en-US'
  utterance.rate = 0.85
  window.speechSynthesis.speak(utterance)
}

function App() {
  const [entries, setEntries] = useState<VocabularyEntry[]>([])
  const [user, setUser] = useState<User | null>(null)
  const [email, setEmail] = useState('')
  const [cloudOpen, setCloudOpen] = useState(false)
  const [syncState, setSyncState] = useState<'local' | 'syncing' | 'synced' | 'error'>('local')
  const [syncMessage, setSyncMessage] = useState('')
  const [oauthStarting, setOauthStarting] = useState<'google' | 'azure' | null>(null)
  const [emailSending, setEmailSending] = useState(false)
  const [emailCooldown, setEmailCooldown] = useState(0)
  const [term, setTerm] = useState('')
  const [meaning, setMeaning] = useState('')
  const [note, setNote] = useState('')
  const [analysisSource, setAnalysisSource] = useState('')
  const [search, setSearch] = useState('')
  const [masteryFilter, setMasteryFilter] = useState('all')
  const [sort, setSort] = useState('newest')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [currentTime, setCurrentTime] = useState(() => new Date())
  const [dictionaryEngine, setDictionaryEngine] = useState<DictionaryEngine>(loadDictionaryEngine)
  const [reviewSelecting, setReviewSelecting] = useState(false)
  const [selectedWordIds, setSelectedWordIds] = useState<string[]>([])
  const [quickReviewRequest, setQuickReviewRequest] = useState(0)
  const syncTimer = useRef<number | null>(null)
  const reviewWordList = useRef<HTMLDivElement | null>(null)

  const changeDictionaryEngine = (engine: DictionaryEngine) => {
    setDictionaryEngine(engine)
    window.localStorage.setItem(dictionaryEngineStorageKey, engine)
  }

  const toggleReviewSelection = () => {
    if (!user) {
      setCloudOpen(true)
      setSyncMessage('AI 复习需要登录，以便服务端安全调用 DeepSeek。')
      return
    }
    setQuickReviewRequest(0)
    setReviewSelecting((active) => !active)
    setSelectedWordIds([])
  }

  const startSingleWordReview = (id: string) => {
    if (!user) {
      setCloudOpen(true)
      setSyncMessage('AI 测试需要登录，以便服务端安全调用 DeepSeek。')
      window.requestAnimationFrame(() => {
        const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
        document.getElementById('cloud-panel')?.scrollIntoView({
          behavior: prefersReducedMotion ? 'auto' : 'smooth',
          block: 'start',
        })
      })
      return
    }
    setSelectedWordIds([id])
    setReviewSelecting(true)
    setQuickReviewRequest((request) => request + 1)
  }

  const toggleSelectedWord = (id: string) => {
    setSelectedWordIds((selected) => selected.includes(id)
      ? selected.filter((wordId) => wordId !== id)
      : [...selected, id])
  }

  const toggleSelectAllWords = () => {
    setSelectedWordIds((selected) => selected.length === entries.length ? [] : entries.map((entry) => entry.id))
  }

  const prepareReviewWords = async () => {
    if (!user) throw new Error('请先登录后再生成复习题')
    const result = await synchronize(user)
    setEntries(await loadEntries(user.id))
    setSelectedWordIds((selected) => selected.map((id) => result.idRemap[id] ?? id))
    setSyncState('synced')
    return result.idRemap
  }

  const applyReviewMasteryChanges = async (changes: MasteryChange[]) => {
    const levels = new Map(changes.map((change) => [change.wordId, change.nextLevel]))
    const now = new Date().toISOString()
    const currentEntries = user ? await loadEntries(user.id) : entries
    const nextEntries = currentEntries.map((entry) => {
      const mastery = levels.get(entry.id)
      return mastery === undefined ? entry : {
        ...entry,
        mastery,
        updatedAt: now,
        syncStatus: user ? 'pending' as const : 'local' as const,
      }
    })
    await updateEntries(nextEntries)
  }

  const performSync = async (activeUser: User) => {
    if (!navigator.onLine) {
      setSyncState('error')
      setSyncMessage('同步失败 · 网络连接\n原因：浏览器当前处于离线状态\n调试方向：恢复网络后点击“立即同步”重试。\n本地词条不会因同步失败而丢失。')
      setCloudOpen(true)
      return
    }
    setSyncState('syncing')
    setSyncMessage('')
    try {
      const result = await synchronize(activeUser)
      setEntries(await loadEntries(activeUser.id))
      setSelectedWordIds((selected) => selected.map((id) => result.idRemap[id] ?? id))
      setSyncState('synced')
      setSyncMessage(result.repairedCount
        ? `已修复 ${result.repairedCount} 条旧版跨账号导入记录，并完成云端同步。`
        : '')
    } catch (error) {
      setSyncState('error')
      setSyncMessage(error instanceof Error ? error.message : '同步失败')
      setCloudOpen(true)
    }
  }

  const syncFromEffect = useEffectEvent(performSync)

  useEffect(() => {
    let active = true

    const start = async () => {
      await initializeStorage()
      const sessionUser = (await supabase?.auth.getSession())?.data.session?.user ?? null
      if (!active) return
      setUser(sessionUser)
      setEntries(await loadEntries(sessionUser?.id ?? null))
      if (sessionUser) void syncFromEffect(sessionUser)
    }

    void start()
    const authSubscription = supabase?.auth.onAuthStateChange((_event, session) => {
      if (!active) return
      setUser(session?.user ?? null)
      void loadEntries(session?.user.id ?? null).then(setEntries)
      if (session?.user) void syncFromEffect(session.user)
    }).data.subscription

    return () => {
      active = false
      authSubscription?.unsubscribe()
      if (syncTimer.current) window.clearTimeout(syncTimer.current)
    }
  }, [])

  useEffect(() => {
    if (emailCooldown <= 0) return
    const timer = window.setInterval(() => {
      setEmailCooldown((seconds) => Math.max(0, seconds - 1))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [emailCooldown])

  useEffect(() => {
    const timer = window.setInterval(() => setCurrentTime(new Date()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!reviewSelecting) return
    const quickReview = quickReviewRequest > 0
    if (!quickReview && !window.matchMedia('(max-width: 520px)').matches) return
    const frame = window.requestAnimationFrame(() => {
      const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      const target = quickReview ? document.getElementById('review-panel') : reviewWordList.current
      target?.scrollIntoView({ behavior: prefersReducedMotion ? 'auto' : 'smooth', block: 'start' })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [reviewSelecting, quickReviewRequest])

  const scheduleSync = (activeUser: User) => {
    if (syncTimer.current) window.clearTimeout(syncTimer.current)
    syncTimer.current = window.setTimeout(() => void performSync(activeUser), 800)
  }

  const updateEntries = async (nextEntries: VocabularyEntry[]) => {
    setEntries(nextEntries)
    await saveEntries(nextEntries)
    if (user) scheduleSync(user)
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const cleanTerm = term.trim()
    if (!cleanTerm) return

    const duplicate = entries.find(
      (entry) => normalizeTerm(entry.term) === normalizeTerm(cleanTerm),
    )
    if (duplicate) {
      setMessage(`“${duplicate.term}” 已经在单词本里了`)
      return
    }

    const now = new Date().toISOString()
    const entry: VocabularyEntry = {
      id: crypto.randomUUID(),
      term: cleanTerm,
      meaning: meaning.trim(),
      note: note.trim(),
      mastery: 0,
      createdAt: now,
      updatedAt: now,
      ownerId: user?.id ?? null,
      deletedAt: null,
      syncStatus: user ? 'pending' : 'local',
    }
    await updateEntries([entry, ...entries])
    setTerm('')
    setMeaning('')
    setNote('')
    setAnalysisSource('')
    setMessage(`已收录 “${entry.term}”`)
  }

  const handleSmartAnalysis = () => {
    const result = analyzeVocabularyText(analysisSource)
    if (!result?.term) {
      setMessage('未识别到单词，请检查粘贴内容')
      return
    }

    setTerm(result.term)
    setMeaning(result.meaning)
    setNote(result.example)
    setMessage(result.meaning || result.example ? '智能分析完成，请确认后收录' : '已识别单词，请补充释义和例句')
  }

  const updateEntry = async (id: string, patch: Partial<VocabularyEntry>) => {
    const nextEntries = entries.map((entry) =>
        entry.id === id
          ? {
              ...entry,
              ...patch,
              updatedAt: new Date().toISOString(),
              syncStatus: user ? 'pending' as const : 'local' as const,
            }
          : entry,
      )
    const changed = nextEntries.find((entry) => entry.id === id)
    if (changed) await saveEntry(changed)
    setEntries(nextEntries)
    if (user) scheduleSync(user)
  }

  const deleteEntry = async (entry: VocabularyEntry) => {
    if (!window.confirm(`确定删除 “${entry.term}” 吗？`)) return
    await deleteStoredEntry(entry.id, user?.id ?? null)
    setEntries(entries.filter((item) => item.id !== entry.id))
    setEditingId(null)
    if (user) scheduleSync(user)
  }

  const clearAllEntries = async () => {
    const entryCount = entries.length
    if (!entryCount || !window.confirm(`确定清空全部 ${entryCount} 个词条吗？\n\n此操作无法撤销，建议先导出备份。`)) return

    try {
      await deleteStoredEntries(entries.map((entry) => entry.id), user?.id ?? null)
      setEntries([])
      setSelectedWordIds([])
      setReviewSelecting(false)
      setEditingId(null)
      if (user) scheduleSync(user)
      setMessage(`已清空 ${entryCount} 个单词`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '清空词库失败')
    }
  }

  const resetAllMastery = async () => {
    const affectedCount = entries.filter((entry) => entry.mastery !== 0).length
    if (!affectedCount || !window.confirm(`确定将 ${affectedCount} 个单词的熟悉程度恢复为 0 吗？\n\n此操作不会删除任何单词。`)) return

    const now = new Date().toISOString()
    const nextEntries = entries.map((entry) => entry.mastery === 0 ? entry : {
      ...entry,
      mastery: 0,
      updatedAt: now,
      syncStatus: user ? 'pending' as const : 'local' as const,
    })

    try {
      await updateEntries(nextEntries)
      setSearch('')
      setMasteryFilter('0')
      setMessage(`已将 ${affectedCount} 个单词的熟悉程度恢复为 0`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '重置熟悉程度失败')
    }
  }

  const exportEntries = () => {
    const blob = new Blob([JSON.stringify(entries, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `wordbook-${new Date().toISOString().slice(0, 10)}.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  const importEntries = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    try {
      const imported = parseBackup(await file.text())
      const targetOwnerId = user?.id ?? null
      const existingTerms = new Set(entries.map((entry) => normalizeTerm(entry.term)))
      let skippedCount = 0
      const prepared = imported.flatMap((entry) => {
        const normalizedTerm = normalizeTerm(entry.term)
        if (existingTerms.has(normalizedTerm)) {
          skippedCount += 1
          return []
        }
        existingTerms.add(normalizedTerm)

        const importedAt = new Date().toISOString()
        return [{
          id: crypto.randomUUID(),
          term: entry.term.trim(),
          meaning: entry.meaning,
          note: entry.note,
          mastery: entry.mastery,
          createdAt: importedAt,
          updatedAt: importedAt,
          ownerId: targetOwnerId,
          deletedAt: null,
          syncStatus: user ? 'pending' as const : 'local' as const,
        }]
      })
      await saveEntries(prepared)
      setEntries([...prepared, ...entries])
      if (user && prepared.length) scheduleSync(user)
      setMessage(`已导入 ${prepared.length} 个单词${skippedCount ? `，跳过 ${skippedCount} 个重复单词` : ''}`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '无法读取备份文件')
    }
  }

  const sendMagicLink = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!supabase || !email.trim() || emailSending || emailCooldown > 0) return
    setEmailSending(true)
    setSyncMessage('正在发送登录邮件…')
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.origin },
    })
    setEmailSending(false)
    setEmailCooldown(60)
    if (!error) {
      setSyncMessage('登录链接已发送，请检查邮箱。链接有效期内无需重复发送。')
      return
    }

    const isRateLimited = error.status === 429 || /rate limit/i.test(error.message)
    setSyncMessage(
      isRateLimited
        ? '登录邮件发送次数已达 Supabase 限制。请使用刚收到的邮件，或等待一段时间后重试。'
        : error.message,
    )
  }

  const signInWithGoogle = async () => {
    if (!supabase || oauthStarting) return
    setOauthStarting('google')
    setSyncMessage('正在前往 Google 登录…')
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin,
      },
    })
    if (error) {
      setOauthStarting(null)
      setSyncMessage(`Google 登录失败：${error.message}`)
    }
  }

  const signInWithMicrosoft = async () => {
    if (!supabase || oauthStarting) return
    setOauthStarting('azure')
    setSyncMessage('正在前往 Microsoft 登录…')
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'azure',
      options: {
        redirectTo: window.location.origin,
        scopes: 'email',
      },
    })
    if (error) {
      setOauthStarting(null)
      setSyncMessage(`Microsoft 登录失败：${error.message}`)
    }
  }

  const signOut = async () => {
    await supabase?.auth.signOut()
    setSyncState('local')
    setCloudOpen(false)
    setReviewSelecting(false)
    setSelectedWordIds([])
  }

  const normalizedSearch = search.trim().toLocaleLowerCase()
  const visibleEntries = entries
    .filter((entry) => {
      const matchesText =
        !normalizedSearch ||
        [entry.term, entry.meaning, entry.note].some((value) =>
          value.toLocaleLowerCase().includes(normalizedSearch),
        )
      const matchesMastery =
        masteryFilter === 'all' ||
        (masteryFilter === 'learning'
          ? entry.mastery > 0 && entry.mastery < 5
          : entry.mastery === Number(masteryFilter))
      return matchesText && matchesMastery
    })
    .sort((left, right) => {
      if (sort === 'oldest') return left.createdAt.localeCompare(right.createdAt)
      if (sort === 'az') return left.term.localeCompare(right.term)
      if (sort === 'mastery') return left.mastery - right.mastery
      return right.createdAt.localeCompare(left.createdAt)
    })

  const masteredCount = entries.filter((entry) => entry.mastery === 5).length
  const learningCount = entries.filter((entry) => entry.mastery > 0 && entry.mastery < 5).length
  const selectedWords = entries.filter((entry) => selectedWordIds.includes(entry.id))
  const allWordsSelected = entries.length > 0 && selectedWordIds.length === entries.length

  const showStatisticEntries = (filter: 'all' | 'learning' | '5') => {
    setSearch('')
    setMasteryFilter(filter)
    window.requestAnimationFrame(() => {
      const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      document.getElementById('library-title')?.scrollIntoView({
        behavior: prefersReducedMotion ? 'auto' : 'smooth',
        block: 'start',
      })
    })
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="词屿首页">
          <span className="brand-mark"><BookOpen size={20} /></span>
          <span>词屿</span>
        </a>
        <div className="header-actions">
          <label className="dictionary-engine">
            <span>网络解释</span>
            <select value={dictionaryEngine} onChange={(event) => changeDictionaryEngine(event.target.value as DictionaryEngine)} aria-label="网络解释引擎">
              {Object.entries(dictionaryEngines).map(([value, engine]) => (
                <option key={value} value={value}>{engine.label}</option>
              ))}
            </select>
            <ChevronDown size={14} aria-hidden="true" />
          </label>
          <time className="datetime-status" dateTime={currentTime.toISOString()} aria-label={`当前日期和时间：${formatCurrentDate(currentTime)} ${formatCurrentTime(currentTime)}`}>
            <Clock3 size={16} aria-hidden="true" />
            <span className="datetime-date datetime-date-full">{formatCurrentDate(currentTime)}</span>
            <span className="datetime-date datetime-date-compact">{formatCurrentDate(currentTime, true)}</span>
            <strong>{formatCurrentTime(currentTime)}</strong>
          </time>
          <button className={`sync-button ${syncState}`} type="button" onClick={() => setCloudOpen(!cloudOpen)} aria-label="云端同步">
            {isCloudConfigured ? <Cloud size={17} /> : <CloudOff size={17} />}
            <span>{user ? (syncState === 'syncing' ? '同步中' : syncState === 'error' ? '同步异常' : '已登录') : '同步'}</span>
          </button>
          <button className="icon-button" type="button" onClick={exportEntries} title="导出备份" disabled={!entries.length}>
            <Download size={18} />
          </button>
          <label className="icon-button" title="导入备份">
            <Upload size={18} />
            <input type="file" accept="application/json" onChange={importEntries} />
          </label>
        </div>
      </header>

      <main id="top">
        {cloudOpen && (
          <section id="cloud-panel" className="cloud-panel" aria-label="云端同步">
            <div>
              <span className="cloud-icon">{isCloudConfigured ? <Cloud size={22} /> : <CloudOff size={22} />}</span>
              <div>
                <h2>{user ? '跨浏览器同步已开启' : '连接云端单词本'}</h2>
                <p>{user ? user.email : isCloudConfigured ? '使用 Google、Microsoft 登录，或通过邮箱获取一次性链接。' : '请先配置 Supabase 环境变量。'}</p>
              </div>
            </div>
            {user ? (
              <div className="cloud-actions">
                <button type="button" onClick={() => void performSync(user)} disabled={syncState === 'syncing'}><RefreshCw size={16} />立即同步</button>
                <button type="button" onClick={() => void signOut()}><LogOut size={16} />退出</button>
              </div>
            ) : isCloudConfigured ? (
              <div className="login-options">
                <button className="google-login" type="button" onClick={() => void signInWithGoogle()} disabled={oauthStarting !== null}>
                  <span className="google-mark" aria-hidden="true">G</span>
                  {oauthStarting === 'google' ? '正在跳转…' : '使用 Google 登录'}
                </button>
                <button className="microsoft-login" type="button" onClick={() => void signInWithMicrosoft()} disabled={oauthStarting !== null}>
                  <span className="microsoft-mark" aria-hidden="true"><i /><i /><i /><i /></span>
                  {oauthStarting === 'azure' ? '正在跳转…' : '使用 Microsoft 登录'}
                </button>
                <div className="login-divider"><span>或使用邮箱</span></div>
                <form onSubmit={sendMagicLink} className="login-form">
                  <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@example.com" required aria-label="登录邮箱" />
                  <button type="submit" disabled={emailSending || emailCooldown > 0}>
                    <LogIn size={16} />
                    {emailSending ? '发送中…' : emailCooldown > 0 ? `${emailCooldown} 秒后重试` : '发送登录链接'}
                  </button>
                </form>
              </div>
            ) : (
              <code>复制 .env.example 为 .env.local 并填写项目配置</code>
            )}
            {syncMessage && <p className={`sync-message ${syncState === 'error' ? 'error' : ''}`} role="status">{syncMessage}</p>}
          </section>
        )}
        <section className="intro">
          <div>
            <p className="eyebrow">MY VOCABULARY</p>
            <h1>把遇见的词，<br />变成自己的语言。</h1>
          </div>
          <div className="stats" aria-label="学习统计">
            <button type="button" className={masteryFilter === 'all' ? 'active' : ''} aria-pressed={masteryFilter === 'all'} aria-controls="vocabulary-results" onClick={() => showStatisticEntries('all')}>
              <strong>{entries.length}</strong><span>全部单词</span>
            </button>
            <button type="button" className={masteryFilter === 'learning' ? 'active' : ''} aria-pressed={masteryFilter === 'learning'} aria-controls="vocabulary-results" onClick={() => showStatisticEntries('learning')}>
              <strong>{learningCount}</strong><span>学习中</span>
            </button>
            <button type="button" className={masteryFilter === '5' ? 'active' : ''} aria-pressed={masteryFilter === '5'} aria-controls="vocabulary-results" onClick={() => showStatisticEntries('5')}>
              <strong>{masteredCount}</strong><span>已掌握</span>
            </button>
          </div>
        </section>

        <section className="capture-panel" aria-labelledby="capture-title">
          <div className="section-heading">
            <span className="section-number">01</span>
            <div><h2 id="capture-title">记下新单词</h2><p>先收录，再慢慢理解。</p></div>
          </div>
          <form className="word-form" onSubmit={handleSubmit}>
            <div className="smart-analyzer">
              <label htmlFor="analysis-source">
                <span><Sparkles size={15} />智能选取</span>
                <small>粘贴包含单词、词性、音标、释义和例句的文字</small>
              </label>
              <textarea
                id="analysis-source"
                value={analysisSource}
                onChange={(event) => setAnalysisSource(event.target.value)}
                placeholder={'convivial adj.\n/kənˈvɪviəl/欢乐友好的（聚会）\n**e.g.** The dinner had a *convivial* atmosphere, full of laughter and toasts.'}
                rows={4}
              />
              <button type="button" onClick={handleSmartAnalysis} disabled={!analysisSource.trim()}>
                <Sparkles size={17} />智能分析
              </button>
            </div>
            <label className="field term-field">
              <span>单词或短语</span>
              <input value={term} onChange={(event) => setTerm(event.target.value)} placeholder="serendipity" autoFocus />
            </label>
            <label className="field">
              <span>释义</span>
              <input value={meaning} onChange={(event) => setMeaning(event.target.value)} placeholder="意外发现美好事物的能力" />
            </label>
            <label className="field note-field">
              <span>笔记 <small>选填</small></span>
              <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="在哪里遇见它？或者写下你的例句" />
            </label>
            <button className="primary-button" type="submit"><Plus size={19} />收录单词</button>
          </form>
          {message && <button className="toast" type="button" onClick={() => setMessage('')}><Check size={16} />{message}<X size={14} /></button>}
        </section>

        <section id="vocabulary-results" className="library" aria-labelledby="library-title">
          <div className="section-heading library-heading">
            <span className="section-number">02</span>
            <div><h2 id="library-title">我的单词本</h2><p role="status" aria-live="polite">{visibleEntries.length} 个词条</p></div>
            <div className="library-actions">
              <button className="clear-all-button" type="button" onClick={() => void clearAllEntries()} disabled={!entries.length}>
                <Trash2 size={17} />清空
              </button>
              <button className="reset-mastery-button" type="button" onClick={() => void resetAllMastery()} disabled={!entries.some((entry) => entry.mastery !== 0)}>
                <RotateCcw size={17} />重置熟悉度
              </button>
              <button className={`review-start-button ${reviewSelecting ? 'active' : ''}`} type="button" onClick={toggleReviewSelection} disabled={!entries.length}>
                {reviewSelecting ? <X size={17} /> : <BrainCircuit size={17} />}
                {reviewSelecting ? '取消复习' : 'AI 复习'}
              </button>
            </div>
          </div>

          <div className="toolbar">
            <label className="search-box">
              <Search size={18} />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索单词、释义或笔记" />
              {search && <button type="button" onClick={() => setSearch('')} title="清除搜索"><X size={16} /></button>}
            </label>
            <label className="select-wrap">
              <select value={masteryFilter} onChange={(event) => setMasteryFilter(event.target.value)} aria-label="按掌握度筛选">
                <option value="all">全部程度</option>
                <option value="learning">学习中 · 1–4</option>
                {masteryLabels.map((label, index) => <option key={label} value={index}>{index} · {label}</option>)}
              </select>
              <ChevronDown size={16} />
            </label>
            <label className="select-wrap">
              <select value={sort} onChange={(event) => setSort(event.target.value)} aria-label="排序方式">
                <option value="newest">最近添加</option>
                <option value="oldest">最早添加</option>
                <option value="az">字母顺序</option>
                <option value="mastery">掌握度优先</option>
              </select>
              <ChevronDown size={16} />
            </label>
          </div>

          {reviewSelecting && (
            <>
              <div className="review-selection-bar">
                <span>已选择 <strong>{selectedWordIds.length}</strong> / {entries.length} 个单词</span>
                <button type="button" onClick={toggleSelectAllWords}>
                  {allWordsSelected ? <X size={16} /> : <CheckSquare2 size={16} />}
                  {allWordsSelected ? '清空选择' : '一键全选'}
                </button>
              </div>
              <ReviewPanel
                key={quickReviewRequest ? `quick-${quickReviewRequest}` : 'manual'}
                selectedWords={selectedWords}
                prepareWords={prepareReviewWords}
                applyMasteryChanges={applyReviewMasteryChanges}
                autoStart={quickReviewRequest > 0}
                onClose={() => {
                  setReviewSelecting(false)
                  setSelectedWordIds([])
                  setQuickReviewRequest(0)
                }}
              />
            </>
          )}

          {!visibleEntries.length ? (
            <div className="empty-state">
              <span><BookOpen size={28} /></span>
              <h3>{entries.length ? '没有找到匹配的单词' : '你的单词本还是空的'}</h3>
              <p>{entries.length ? '换个关键词或筛选条件试试。' : '在上方记下今天遇到的第一个新词。'}</p>
            </div>
          ) : (
            <div className="word-list" ref={reviewWordList}>
              {visibleEntries.map((entry, index) => (
                <article className={`word-card ${reviewSelecting ? 'review-word-card' : ''} ${selectedWordIds.includes(entry.id) ? 'selected-for-review' : ''}`} key={entry.id}>
                  <div className={`word-index ${reviewSelecting ? 'review-select-index' : ''}`}>
                    {reviewSelecting ? (
                      <label title={`选择 ${entry.term}`}>
                        <input type="checkbox" checked={selectedWordIds.includes(entry.id)} onChange={() => toggleSelectedWord(entry.id)} aria-label={`选择 ${entry.term} 进行复习`} />
                        <span><Check size={15} /></span>
                      </label>
                    ) : String(index + 1).padStart(2, '0')}
                  </div>
                  <div className="word-content">
                    <div className="word-title-row">
                      <div>
                        <div className="word-heading">
                          <h3>{entry.term}</h3>
                          <button type="button" onClick={() => pronounce(entry.term)} title={`朗读 ${entry.term}`} aria-label={`朗读 ${entry.term}`}>
                            <Volume2 size={18} />
                          </button>
                        </div>
                        <time dateTime={entry.createdAt}>添加于 {formatDate(entry.createdAt)}</time>
                      </div>
                      <div className="card-actions">
                        <button type="button" onClick={() => startSingleWordReview(entry.id)} disabled={reviewSelecting} title={`用 ${entry.term} 进行 AI 测试（5 题 · 基础）`} aria-label={`用 ${entry.term} 进行 AI 测试，5 题，基础难度`}>
                          <BrainCircuit size={17} />
                        </button>
                        <a href={dictionaryEngines[dictionaryEngine].getUrl(entry.term)} target="_blank" rel="noreferrer" title={`使用 ${dictionaryEngines[dictionaryEngine].label} 查看 ${entry.term} 的详细解释`} aria-label={`使用 ${dictionaryEngines[dictionaryEngine].label} 查看 ${entry.term} 的详细解释`}>
                          <ExternalLink size={17} />
                        </a>
                        <button type="button" onClick={() => setEditingId(editingId === entry.id ? null : entry.id)} title="编辑"><Edit3 size={17} /></button>
                        <button type="button" onClick={() => deleteEntry(entry)} title="删除"><Trash2 size={17} /></button>
                      </div>
                    </div>
                    {editingId === entry.id ? (
                      <div className="edit-fields">
                        <input value={entry.meaning} onChange={(event) => updateEntry(entry.id, { meaning: event.target.value })} placeholder="补充释义" aria-label={`${entry.term} 的释义`} />
                        <input value={entry.note} onChange={(event) => updateEntry(entry.id, { note: event.target.value })} placeholder="补充笔记或例句" aria-label={`${entry.term} 的笔记`} />
                        <button type="button" onClick={() => setEditingId(null)}><Check size={16} />完成</button>
                      </div>
                    ) : (
                      <div className="definition">
                        <p>{entry.meaning || '暂未添加释义'}</p>
                        {entry.note && (
                          <div className="example-row">
                            <blockquote>{entry.note}</blockquote>
                            <button type="button" onClick={() => pronounce(entry.note)} title="朗读例句" aria-label={`朗读 ${entry.term} 的例句`}>
                              <Volume2 size={16} />
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                    <div className="mastery-row">
                      <span>掌握程度</span>
                      <div className="mastery-control" role="group" aria-label={`${entry.term} 的掌握程度`}>
                        {masteryLabels.map((label, level) => (
                          <button
                            key={label}
                            type="button"
                            className={level === entry.mastery ? 'active' : ''}
                            onClick={() => updateEntry(entry.id, { mastery: level })}
                            title={`${level} · ${label}`}
                            aria-label={`${level}，${label}`}
                            aria-pressed={level === entry.mastery}
                          >{level}</button>
                        ))}
                      </div>
                      <strong>{masteryLabels[entry.mastery]}</strong>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </main>

      <footer>
        <span>词屿 · 本地单词本</span>
        <span>{user ? '数据已加密传输并同步到云端' : '当前数据保存在这台设备上'}</span>
      </footer>
    </div>
  )
}

export default App
