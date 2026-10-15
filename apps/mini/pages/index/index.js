const {
  checkHealth,
  generateFlashcards,
  generatePassage,
  generateReview,
  generateSpeech,
  linkWechatAccount,
  loadSession,
  loginWithWechat,
  sendWordChatMessage,
  synchronizeEntries,
} = require('../../utils/api')
const {
  AI_PROVIDERS,
  DEFAULT_AI_PROVIDER,
  DEFAULT_PAGE_SIZE,
  MASTERY_FILTER_OPTIONS,
  PAGE_SIZE_OPTIONS,
  VOCABULARY_SORT_OPTIONS,
  analyzeVocabularyText,
  calculateMasteryChanges,
  clampFlashcardIndex,
  filterAndSortVocabularyEntries,
  normalizeAiProvider,
  paginate,
  selectFlashcardWords,
  appendWordChatQuestion,
  appendWordChatReply,
  MAX_WORD_CHAT_MESSAGE_LENGTH,
  WORD_CHAT_SUGGESTIONS,
} = require('../../vendor/wordbook-core')
const { createEntry, loadAllEntries, loadEntries, saveEntries } = require('../../utils/storage')
const { destroySpeech, playSpeech, setSpeechRate, stopSpeech } = require('../../utils/speech')

const masteryLabels = ['未掌握', '刚认识', '有印象', '基本理解', '较熟练', '已掌握']
const masteryFilterLabels = ['全部程度', '学习中 · 1–4', ...masteryLabels.map((label, index) => `${index} · ${label}`)]
const sortLabels = ['最近添加', '最早添加', '字母顺序', '掌握度优先']
const speechRates = [0.8, 1, 1.25]
const speechRateLabels = ['慢 0.8×', '正常 1×', '快 1.25×']
const SPEECH_RATE_KEY = 'wordbook-mini:speech-rate:v1'
const AI_PROVIDER_KEY = 'wordbook-mini:ai-provider:v1'

function decorateEntries(entries, selectedIds = []) {
  const selected = new Set(selectedIds)
  return entries.map((entry) => ({
    ...entry,
    masteryLabel: masteryLabels[entry.mastery] || masteryLabels[0],
    aiSelected: selected.has(entry.id),
  }))
}

function decorateQuiz(quiz) {
  return {
    ...quiz,
    questions: quiz.questions.map((question, questionIndex) => ({
      ...question,
      questionIndex,
      answered: false,
      selectedIndex: -1,
      optionItems: question.options.map((text, optionIndex) => ({ text, optionIndex, state: 'idle' })),
    })),
  }
}

Page({
  data: {
    entries: [],
    visibleEntries: [],
    search: '',
    masteryFilter: 'all',
    masteryFilterIndex: 0,
    masteryFilterLabels,
    sort: 'newest',
    sortIndex: 0,
    sortLabels,
    currentPage: 1,
    pageSize: DEFAULT_PAGE_SIZE,
    pageSizeIndex: PAGE_SIZE_OPTIONS.indexOf(DEFAULT_PAGE_SIZE),
    pageSizeOptions: PAGE_SIZE_OPTIONS,
    totalPages: 1,
    filteredEntryCount: 0,
    pageFirstItem: 0,
    pageLastItem: 0,
    term: '',
    meaning: '',
    note: '',
    editingId: '',
    editTerm: '',
    editMeaning: '',
    editNote: '',
    editMastery: 0,
    editError: '',
    analysisSource: '',
    message: '',
    healthStatus: 'idle',
    healthMessage: '尚未检测 Supabase',
    loginStatus: 'idle',
    loginMessage: '尚未连接微信身份',
    syncStatus: 'idle',
    syncMessage: '登录后可同步词库',
    linkCode: '',
    linkStatus: 'idle',
    linkMessage: '在 Web 词屿生成一次性绑定码',
    aiSelectedIds: [],
    selectionMode: false,
    aiProviders: AI_PROVIDERS,
    aiProviderIndex: 0,
    aiProvider: DEFAULT_AI_PROVIDER,
    aiLength: 'short',
    aiDifficulty: 'basic',
    aiStatus: 'idle',
    aiMessage: '从词库选择单词，生成专属学习材料',
    chatWord: null,
    chatMessages: [],
    chatInput: '',
    chatLoading: false,
    chatError: '',
    chatSuggestions: WORD_CHAT_SUGGESTIONS,
    chatMaxLength: MAX_WORD_CHAT_MESSAGE_LENGTH,
    chatScrollTarget: '',
    passage: null,
    flashcards: null,
    flashcardWordIds: [],
    flashcardIndex: 0,
    currentFlashcard: null,
    speechStatus: 'idle',
    speechText: '',
    speechSource: '',
    speechWordId: '',
    speechRateIndex: 1,
    speechRateLabels,
    quiz: null,
    quizWords: [],
    quizAnswers: {},
    currentQuestion: null,
    quizCurrentIndex: 0,
    quizComplete: false,
    quizAnsweredCount: 0,
    quizCorrectCount: 0,
    masteryChanges: [],
    masteryMessage: '',
    userId: '',
  },

  onLoad() {
    this.chatRequestId = 0
    this.speechCache = Object.create(null)
    this.speechRequestId = 0
    const savedSpeechRateIndex = speechRates.indexOf(Number(wx.getStorageSync(SPEECH_RATE_KEY)))
    const speechRateIndex = savedSpeechRateIndex < 0 ? 1 : savedSpeechRateIndex
    const aiProvider = normalizeAiProvider(wx.getStorageSync(AI_PROVIDER_KEY))
    setSpeechRate(speechRates[speechRateIndex])
    const session = loadSession()
    this.setData({
      speechRateIndex,
      aiProvider,
      aiProviderIndex: AI_PROVIDERS.findIndex((provider) => provider.id === aiProvider),
      loginStatus: session ? 'ok' : 'idle',
      loginMessage: session ? '已恢复微信登录会话' : '尚未连接微信身份',
      userId: session && session.userId ? session.userId : '',
    })
    this.refreshEntries()
    if (session) this.synchronize(false)
  },

  onUnload() {
    this.chatRequestId += 1
    if (this.syncTimer) clearTimeout(this.syncTimer)
    if (this.advanceTimer) clearTimeout(this.advanceTimer)
    this.speechRequestId += 1
    destroySpeech()
  },

  refreshEntries() {
    const entries = decorateEntries(loadEntries(), this.data.aiSelectedIds)
    const filteredEntries = filterAndSortVocabularyEntries(entries, {
      search: this.data.search,
      masteryFilter: this.data.masteryFilter,
      sort: this.data.sort,
    })
    const pagination = paginate(filteredEntries, this.data.currentPage, this.data.pageSize)
    this.setData({
      entries,
      visibleEntries: pagination.items,
      currentPage: pagination.currentPage,
      totalPages: pagination.totalPages,
      filteredEntryCount: pagination.totalItems,
      pageFirstItem: pagination.firstItemNumber,
      pageLastItem: pagination.lastItemNumber,
    })
  },

  handleFieldInput(event) {
    const { field } = event.currentTarget.dataset
    this.setData({ [field]: event.detail.value })
  },

  handleSearch(event) {
    this.setData({ search: event.detail.value, currentPage: 1 }, () => this.refreshEntries())
  },

  handleMasteryFilterChange(event) {
    const masteryFilterIndex = Number(event.detail.value)
    this.setData({
      masteryFilterIndex,
      masteryFilter: MASTERY_FILTER_OPTIONS[masteryFilterIndex] || 'all',
      currentPage: 1,
    }, () => this.refreshEntries())
  },

  handleSortChange(event) {
    const sortIndex = Number(event.detail.value)
    this.setData({
      sortIndex,
      sort: VOCABULARY_SORT_OPTIONS[sortIndex] || 'newest',
      currentPage: 1,
    }, () => this.refreshEntries())
  },

  handlePageSizeChange(event) {
    const pageSizeIndex = Number(event.detail.value)
    this.setData({
      pageSizeIndex,
      pageSize: PAGE_SIZE_OPTIONS[pageSizeIndex] || DEFAULT_PAGE_SIZE,
      currentPage: 1,
    }, () => this.refreshEntries())
  },

  handleSpeechRateChange(event) {
    const speechRateIndex = Number(event.detail.value)
    if (!Number.isInteger(speechRateIndex) || !speechRates[speechRateIndex]) return
    setSpeechRate(speechRates[speechRateIndex])
    wx.setStorageSync(SPEECH_RATE_KEY, speechRates[speechRateIndex])
    this.setData({ speechRateIndex })
  },

  handlePageChange(event) {
    const { action } = event.currentTarget.dataset
    let currentPage = this.data.currentPage
    if (action === 'first') currentPage = 1
    if (action === 'previous') currentPage -= 1
    if (action === 'next') currentPage += 1
    if (action === 'last') currentPage = this.data.totalPages
    this.setData({ currentPage }, () => this.refreshEntries())
  },

  handleLinkCode(event) {
    const raw = event.detail.value.replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 8)
    const formatted = raw.length > 4 ? `${raw.slice(0, 4)}-${raw.slice(4)}` : raw
    this.setData({ linkCode: formatted })
  },

  toggleAiWord(event) {
    if (this.advanceTimer) {
      clearTimeout(this.advanceTimer)
      this.advanceTimer = null
    }
    const { id } = event.currentTarget.dataset
    const selected = new Set(this.data.aiSelectedIds)
    if (selected.has(id)) selected.delete(id)
    else if (selected.size < 10) selected.add(id)
    else {
      this.setData({ aiMessage: '小程序单次最多选择 10 个单词' })
      return
    }
    this.setData({
      aiSelectedIds: [...selected],
      passage: null,
      flashcards: null,
      flashcardWordIds: [],
      flashcardIndex: 0,
      currentFlashcard: null,
      quiz: null,
      quizAnswers: {},
      currentQuestion: null,
      quizComplete: false,
      masteryChanges: [],
      masteryMessage: '',
    }, () => this.refreshEntries())
  },

  beginWordSelection(event) {
    const { id } = event.currentTarget.dataset
    if (!this.data.entries.some((entry) => entry.id === id)) return
    this.setData({ selectionMode: true })
    if (this.data.aiSelectedIds.includes(id)) return
    this.toggleAiWord(event)
  },

  finishWordSelection() {
    this.setData({ selectionMode: false })
  },

  preventWordSelection() {},

  chooseAiLength(event) {
    this.setData({ aiLength: event.currentTarget.dataset.length })
  },

  chooseAiDifficulty(event) {
    this.setData({ aiDifficulty: event.currentTarget.dataset.difficulty })
  },

  chooseAiProvider(event) {
    const provider = AI_PROVIDERS[Number(event.detail.value)]
    if (!provider) return
    wx.setStorageSync(AI_PROVIDER_KEY, provider.id)
    this.setData({ aiProvider: provider.id, aiProviderIndex: Number(event.detail.value) })
  },

  openWordChat(event) {
    const word = this.data.entries.find((entry) => entry.id === event.currentTarget.dataset.id)
    if (!word) return
    this.chatRequestId += 1
    this.setData({
      chatWord: word,
      chatMessages: [],
      chatInput: '',
      chatLoading: false,
      chatError: '',
      chatScrollTarget: '',
    })
  },

  closeWordChat() {
    this.chatRequestId += 1
    this.setData({ chatWord: null, chatMessages: [], chatInput: '', chatLoading: false, chatError: '' })
  },

  handleChatInput(event) {
    this.setData({ chatInput: event.detail.value.slice(0, MAX_WORD_CHAT_MESSAGE_LENGTH) })
  },

  askChatSuggestion(event) {
    this.askWordChat(event.currentTarget.dataset.question)
  },

  sendChatInput() {
    this.askWordChat(this.data.chatInput)
  },

  async askWordChat(question) {
    const cleanQuestion = String(question || '').trim().slice(0, MAX_WORD_CHAT_MESSAGE_LENGTH)
    if (!cleanQuestion || !this.data.chatWord || this.data.chatLoading) return
    const requestId = ++this.chatRequestId
    const wordId = this.data.chatWord.id
    const messages = appendWordChatQuestion(this.data.chatMessages, cleanQuestion)
    this.setData({ chatMessages: messages, chatInput: '', chatError: '', chatLoading: true, chatScrollTarget: 'chat-bottom' })
    try {
      if (!loadSession()) throw new Error('请先连接微信身份')
      if (!loadEntries().some((entry) => entry.id === wordId && entry.syncStatus === 'synced')) {
        await this.synchronize(false)
        if (this.data.syncStatus !== 'ok') throw new Error(this.data.syncMessage || '词条同步失败')
      }
      if (requestId !== this.chatRequestId) return
      const result = await sendWordChatMessage(wordId, messages, this.data.aiProvider)
      if (requestId !== this.chatRequestId) return
      this.setData({
        chatMessages: appendWordChatReply(this.data.chatMessages, result.reply),
        chatScrollTarget: 'chat-bottom',
      })
    } catch (error) {
      if (requestId === this.chatRequestId) this.setData({ chatError: error.message || 'AI 对话暂时不可用' })
    } finally {
      if (requestId === this.chatRequestId) this.setData({ chatLoading: false })
    }
  },

  async prepareAiWords() {
    if (!loadSession()) throw new Error('请先连接微信身份')
    if (!this.data.aiSelectedIds.length) throw new Error('请先从词库选择单词')
    await this.synchronize(false)
    return this.data.aiSelectedIds
  },

  async createPassage() {
    if (this.data.aiStatus === 'checking') return
    this.setData({
      aiStatus: 'checking',
      aiMessage: 'AI 正在编织短文…',
      flashcards: null,
      currentFlashcard: null,
      quiz: null,
    })
    try {
      const wordIds = await this.prepareAiWords()
      const passage = await generatePassage(wordIds, this.data.aiLength, this.data.aiProvider)
      this.setData({ aiStatus: 'ok', aiMessage: '短文已生成', passage })
    } catch (error) {
      this.setData({ aiStatus: 'error', aiMessage: error.message || 'AI 短文生成失败' })
    }
  },

  async createReview() {
    if (this.data.aiStatus === 'checking') return
    if (this.advanceTimer) {
      clearTimeout(this.advanceTimer)
      this.advanceTimer = null
    }
    this.setData({
      aiStatus: 'checking',
      aiMessage: 'AI 正在准备复习题…',
      passage: null,
      flashcards: null,
      currentFlashcard: null,
    })
    try {
      const wordIds = await this.prepareAiWords()
      const questionCount = Math.max(5, wordIds.length)
      const result = await generateReview(wordIds, questionCount, this.data.aiDifficulty, this.data.aiProvider)
      const quiz = decorateQuiz(result)
      const selected = new Set(wordIds)
      this.setData({
        aiStatus: 'ok',
        aiMessage: `复习题已生成 · 共 ${questionCount} 题`,
        quiz,
        quizWords: loadEntries().filter((entry) => selected.has(entry.id)),
        quizAnswers: {},
        currentQuestion: quiz.questions[0],
        quizCurrentIndex: 0,
        quizComplete: false,
        quizAnsweredCount: 0,
        quizCorrectCount: 0,
        masteryChanges: [],
        masteryMessage: '',
      }, () => wx.pageScrollTo({ selector: '#ai-review-result', duration: 300 }))
    } catch (error) {
      this.setData({ aiStatus: 'error', aiMessage: error.message || 'AI 复习题生成失败' })
    }
  },

  startSingleWordReview(event) {
    const { id } = event.currentTarget.dataset
    if (this.data.aiStatus === 'checking' || this.data.selectionMode) return
    if (!this.data.entries.some((entry) => entry.id === id)) return
    if (!loadSession()) {
      wx.showToast({ title: '请先连接微信身份', icon: 'none' })
      return
    }
    this.setData({ aiSelectedIds: [id], aiDifficulty: 'basic', quiz: null, currentQuestion: null }, () => {
      wx.pageScrollTo({ selector: '#ai-review-section', duration: 300 })
      this.createReview()
    })
  },

  async createFlashcards() {
    if (this.data.aiStatus === 'checking') return
    this.setData({
      aiStatus: 'checking',
      aiMessage: 'AI 正在制作学习卡片…',
      passage: null,
      quiz: null,
      currentQuestion: null,
    })
    try {
      if (!loadSession()) throw new Error('请先连接微信身份')
      const sourceWords = selectFlashcardWords(loadEntries(), this.data.aiSelectedIds)
      if (!sourceWords.length) throw new Error('请先在词库收录单词')
      await this.synchronize(false)
      const wordIds = sourceWords.map((word) => word.id)
      const flashcards = await generateFlashcards(wordIds, this.data.aiProvider)
      this.setData({
        aiStatus: 'ok',
        aiMessage: `学习卡片已生成 · 共 ${flashcards.cards.length} 张`,
        flashcards,
        flashcardWordIds: wordIds,
        flashcardIndex: 0,
        currentFlashcard: flashcards.cards[0],
      }, () => this.speakFlashcard())
    } catch (error) {
      this.setData({ aiStatus: 'error', aiMessage: error.message || 'AI 卡片生成失败' })
    }
  },

  showFlashcard(index) {
    const flashcards = this.data.flashcards
    if (!flashcards || !flashcards.cards.length) return
    const flashcardIndex = clampFlashcardIndex(index, flashcards.cards.length)
    this.stopFlashcardSpeech()
    this.setData({ flashcardIndex, currentFlashcard: flashcards.cards[flashcardIndex] }, () => this.speakFlashcard())
  },

  async speakFlashcard() {
    const card = this.data.currentFlashcard
    if (card) await this.speakText(`${card.word}. ${card.usage}`, 'flashcard', '')
  },

  async speakWord(event) {
    const entry = this.data.entries.find((item) => item.id === event.currentTarget.dataset.id)
    if (!entry) return
    const example = entry.note.split(/\r?\n/).map((line) => line.trim())
      .find((line) => /[A-Za-z]/.test(line) && !/[\u3400-\u9fff]/.test(line))
    const fullText = example ? `${entry.term}. ${example}` : entry.term
    await this.speakText(fullText.length <= 500 ? fullText : entry.term, 'word', entry.id)
  },

  async speakText(text, source, wordId) {
    if (!text) return
    if (this.data.speechText === text && this.data.speechSource === source && this.data.speechStatus === 'loading') return
    if (this.data.speechText === text && this.data.speechSource === source && this.data.speechStatus === 'playing') {
      this.stopFlashcardSpeech()
      return
    }

    const requestId = ++this.speechRequestId
    stopSpeech()
    this.setData({ speechStatus: 'loading', speechText: text, speechSource: source, speechWordId: wordId })
    try {
      let audio = this.speechCache[text]
      if (!audio) {
        const result = await generateSpeech(text)
        audio = result.audio
        this.speechCache[text] = audio
      }
      if (requestId !== this.speechRequestId) return
      await playSpeech(audio, {
        onEnded: () => {
          if (requestId === this.speechRequestId) this.setData({ speechStatus: 'idle', speechText: '', speechSource: '', speechWordId: '' })
        },
        onError: () => {
          if (requestId !== this.speechRequestId) return
          this.setData({ speechStatus: 'error', speechText: '', speechSource: '', speechWordId: '' })
          wx.showToast({ title: '播放失败，请重试', icon: 'none' })
        },
      })
      if (requestId === this.speechRequestId) this.setData({ speechStatus: 'playing' })
    } catch (error) {
      if (requestId !== this.speechRequestId) return
      this.setData({ speechStatus: 'error', speechText: '', speechSource: '', speechWordId: '' })
      wx.showToast({ title: error.message || '发音失败，请重试', icon: 'none' })
    }
  },

  stopFlashcardSpeech() {
    this.speechRequestId += 1
    stopSpeech()
    if (this.data.speechStatus !== 'idle' || this.data.speechText) this.setData({ speechStatus: 'idle', speechText: '', speechSource: '', speechWordId: '' })
  },

  navigateFlashcard(event) {
    const offset = event.currentTarget.dataset.direction === 'previous' ? -1 : 1
    this.showFlashcard(this.data.flashcardIndex + offset)
  },

  selectFlashcard(event) {
    this.showFlashcard(Number(event.currentTarget.dataset.index))
  },

  closeFlashcards() {
    this.stopFlashcardSpeech()
    this.setData({ flashcards: null, flashcardWordIds: [], flashcardIndex: 0, currentFlashcard: null })
  },

  startFlashcardReview() {
    if (!this.data.flashcardWordIds.length) return
    this.stopFlashcardSpeech()
    this.setData({
      aiSelectedIds: this.data.flashcardWordIds,
      flashcards: null,
      flashcardIndex: 0,
      currentFlashcard: null,
    }, () => this.createReview())
  },

  answerReview(event) {
    const optionIndex = Number(event.currentTarget.dataset.option)
    const quiz = this.data.quiz
    const questionIndex = this.data.quizCurrentIndex
    if (!quiz || !this.data.currentQuestion || this.data.currentQuestion.answered) return

    const questions = quiz.questions.map((question, index) => {
      if (index !== questionIndex) return question
      return {
        ...question,
        answered: true,
        answerCorrect: optionIndex === question.correctIndex,
        feedbackTitle: optionIndex === question.correctIndex
          ? '回答正确 · 2 秒后自动进入下一题'
          : `正确答案：${question.options[question.correctIndex]}`,
        selectedIndex: optionIndex,
        optionItems: question.optionItems.map((option) => ({
          ...option,
          state: option.optionIndex === question.correctIndex
            ? 'correct'
            : option.optionIndex === optionIndex ? 'wrong' : 'idle',
        })),
      }
    })
    const correct = quiz.questions[questionIndex].correctIndex === optionIndex
    const nextAnswers = { ...this.data.quizAnswers, [questionIndex]: optionIndex }
    this.setData({
      quiz: { ...quiz, questions },
      quizAnswers: nextAnswers,
      currentQuestion: questions[questionIndex],
      quizAnsweredCount: this.data.quizAnsweredCount + 1,
      quizCorrectCount: this.data.quizCorrectCount + (correct ? 1 : 0),
    })
    if (correct) {
      this.advanceTimer = setTimeout(() => {
        this.advanceTimer = null
        this.nextReviewQuestion(nextAnswers)
      }, 2000)
    }
  },

  nextReviewQuestion(input = this.data.quizAnswers) {
    const finalAnswers = input && input.currentTarget ? this.data.quizAnswers : input
    if (this.advanceTimer) {
      clearTimeout(this.advanceTimer)
      this.advanceTimer = null
    }
    const quiz = this.data.quiz
    if (!quiz || !this.data.currentQuestion || !this.data.currentQuestion.answered) return
    const nextIndex = this.data.quizCurrentIndex + 1
    if (nextIndex >= quiz.questions.length) {
      this.finishReview(finalAnswers)
      return
    }
    this.setData({
      quizCurrentIndex: nextIndex,
      currentQuestion: quiz.questions[nextIndex],
    })
  },

  finishReview(answers) {
    const quiz = this.data.quiz
    if (!quiz) return
    const changes = calculateMasteryChanges(quiz, answers, this.data.quizWords, this.data.aiDifficulty)
    const changed = changes.filter((change) => change.nextLevel !== change.previousLevel)
    const decoratedChanges = changes.map((change) => ({
      ...change,
      direction: change.nextLevel > change.previousLevel
        ? 'up'
        : change.nextLevel < change.previousLevel ? 'down' : 'same',
      evidenceLabel: `${change.evidence > 0 ? '+' : ''}${change.evidence}`,
    }))

    if (changed.length) {
      const levels = new Map(changed.map((change) => [change.wordId, change.nextLevel]))
      const updatedAt = new Date().toISOString()
      const entries = loadAllEntries().map((entry) => {
        const mastery = levels.get(entry.id)
        return mastery === undefined ? entry : {
          ...entry,
          mastery,
          updatedAt,
          syncStatus: 'pending',
        }
      })
      saveEntries(entries)
      this.refreshEntries()
      this.queueSync()
    }

    this.setData({
      currentQuestion: null,
      quizComplete: true,
      masteryChanges: decoratedChanges,
      masteryMessage: changed.length
        ? `已保存 ${changed.length} 个熟练度调整并等待同步`
        : '本轮证据不足，熟练度保持不变',
      aiMessage: `复习完成 · 答对 ${this.data.quizCorrectCount} / ${quiz.questions.length} 题`,
    })
  },

  analyzeText() {
    const result = analyzeVocabularyText(this.data.analysisSource)
    if (!result || !result.term) {
      this.setData({ message: '未识别到英文单词，请检查粘贴内容' })
      return
    }

    this.setData({
      term: result.term,
      meaning: result.meaning,
      note: result.example,
      message: '智能分析完成，请确认后收录',
    })
  },

  addEntry() {
    const term = this.data.term.trim()
    if (!term) {
      this.setData({ message: '请先填写单词或短语' })
      return
    }

    const normalizedTerm = term.toLocaleLowerCase()
    if (this.data.entries.some((entry) => entry.term.toLocaleLowerCase() === normalizedTerm)) {
      this.setData({ message: `“${term}” 已经在词库中` })
      return
    }

    const entry = createEntry({
      term,
      meaning: this.data.meaning,
      note: this.data.note,
    })
    saveEntries([entry, ...loadAllEntries()])
    this.setData({
      term: '',
      meaning: '',
      note: '',
      analysisSource: '',
      message: `已收录 “${entry.term}”`,
    })
    this.refreshEntries()
    this.queueSync()
  },

  editEntry(event) {
    const entry = this.data.entries.find((item) => item.id === event.currentTarget.dataset.id)
    if (!entry) return
    this.setData({
      editingId: entry.id,
      editTerm: entry.term,
      editMeaning: entry.meaning,
      editNote: entry.note,
      editMastery: entry.mastery,
      editError: '',
    })
  },

  handleEditInput(event) {
    this.setData({ [event.currentTarget.dataset.field]: event.detail.value, editError: '' })
  },

  adjustEditMastery(event) {
    const delta = Number(event.currentTarget.dataset.delta)
    this.setData({ editMastery: Math.max(0, Math.min(5, this.data.editMastery + delta)) })
  },

  cancelEdit() {
    this.setData({ editingId: '', editError: '' })
  },

  saveEdit() {
    const { editingId } = this.data
    if (!editingId) return
    const term = this.data.editTerm.trim()
    if (!term) {
      this.setData({ editError: '请先填写单词或短语' })
      return
    }
    const normalizedTerm = term.toLocaleLowerCase()
    if (this.data.entries.some((entry) => entry.id !== editingId && entry.term.toLocaleLowerCase() === normalizedTerm)) {
      this.setData({ editError: `“${term}” 已经在词库中` })
      return
    }

    const entries = loadAllEntries()
    if (!entries.some((entry) => entry.id === editingId && !entry.deletedAt)) {
      this.setData({ editError: '词条已删除，请重新打开词库' })
      return
    }
    const updatedAt = new Date().toISOString()
    saveEntries(entries.map((entry) => entry.id === editingId
      ? {
          ...entry,
          term,
          meaning: this.data.editMeaning.trim(),
          note: this.data.editNote.trim(),
          mastery: this.data.editMastery,
          updatedAt,
          syncStatus: 'pending',
        }
      : entry))
    this.setData({ editingId: '', editError: '', message: `已更新 “${term}”` })
    this.refreshEntries()
    this.queueSync()
  },

  deleteEntry(event) {
    const { id } = event.currentTarget.dataset
    const target = this.data.entries.find((entry) => entry.id === id)
    if (!target) return

    wx.showModal({
      title: '删除单词',
      content: `确定删除“${target.term}”吗？`,
      confirmColor: '#a43c2d',
      success: (result) => {
        if (!result.confirm) return
        const deletedAt = new Date().toISOString()
        const entries = loadAllEntries().map((entry) => entry.id === id
          ? { ...entry, deletedAt, updatedAt: deletedAt, syncStatus: 'pending' }
          : entry)
        saveEntries(entries)
        this.setData({ message: `已删除 “${target.term}”` })
        this.refreshEntries()
        this.queueSync()
      },
    })
  },

  async testConnection() {
    this.setData({ healthStatus: 'checking', healthMessage: '正在连接 Supabase…' })
    const startedAt = Date.now()
    try {
      const result = await checkHealth()
      this.setData({
        healthStatus: 'ok',
        healthMessage: `连接正常 · ${Date.now() - startedAt} ms · ${result.region || 'unknown'}`,
      })
    } catch (error) {
      this.setData({
        healthStatus: 'error',
        healthMessage: error.message || 'Supabase 连接失败',
      })
    }
  },

  async login() {
    this.setData({ loginStatus: 'checking', loginMessage: '正在获取微信身份…' })
    try {
      const session = await loginWithWechat()
      this.setData({
        loginStatus: 'ok',
        loginMessage: '微信身份连接成功',
        userId: session.userId || '',
      })
      await this.synchronize(false)
    } catch (error) {
      this.setData({
        loginStatus: 'error',
        loginMessage: error.message || '微信登录失败',
      })
    }
  },

  async bindWebAccount() {
    if (!this.data.linkCode) {
      this.setData({ linkStatus: 'error', linkMessage: '请先输入 Web 端生成的绑定码' })
      return
    }

    this.setData({ linkStatus: 'checking', linkMessage: '正在合并 Web 与微信词库…' })
    try {
      const result = await linkWechatAccount(this.data.linkCode)
      this.setData({
        linkCode: '',
        linkStatus: 'ok',
        linkMessage: `绑定完成 · 迁移 ${result.movedCount} 条，合并 ${result.mergedCount} 条`,
      })
      await this.synchronize(false)
    } catch (error) {
      this.setData({
        linkStatus: 'error',
        linkMessage: error.message || 'Web 与微信账号绑定失败',
      })
    }
  },

  queueSync() {
    if (!loadSession()) return
    if (this.syncTimer) clearTimeout(this.syncTimer)
    this.setData({ syncStatus: 'idle', syncMessage: '本地更改等待同步' })
    this.syncTimer = setTimeout(() => this.synchronize(false), 800)
  },

  async synchronize(showSuccessMessage = true) {
    if (!loadSession()) {
      this.setData({ syncStatus: 'error', syncMessage: '请先连接微信身份' })
      return
    }

    this.setData({ syncStatus: 'checking', syncMessage: '正在合并本地与云端词库…' })
    try {
      const result = await synchronizeEntries(loadAllEntries())
      const entries = result.entries.map((entry) => ({ ...entry, syncStatus: 'synced' }))
      saveEntries(entries)
      this.refreshEntries()
      this.setData({
        syncStatus: 'ok',
        syncMessage: `同步完成 · ${entries.filter((entry) => !entry.deletedAt).length} 个单词`,
        message: showSuccessMessage ? '本地与云端词库已同步' : this.data.message,
      })
    } catch (error) {
      const session = loadSession()
      this.setData({
        syncStatus: 'error',
        syncMessage: error.message || '词库同步失败',
        loginStatus: session ? this.data.loginStatus : 'error',
        loginMessage: session ? this.data.loginMessage : '微信会话已失效，请重新连接',
      })
    }
  },
})
