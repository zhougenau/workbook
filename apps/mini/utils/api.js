const SUPABASE_FUNCTIONS_URL = 'https://gvgztuwklhlhzorcoouh.supabase.co/functions/v1'
const SESSION_KEY = 'wordbook-mini:session:v1'
const { parseGeneratedFlashcards, parseWordChatResponse } = require('../vendor/wordbook-core')

function request(path, options = {}) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${SUPABASE_FUNCTIONS_URL}${path}`,
      method: options.method || 'GET',
      data: options.data,
      header: {
        'Content-Type': 'application/json',
        ...(options.header || {}),
      },
      timeout: options.timeout || 10000,
      success(response) {
        if (response.statusCode >= 200 && response.statusCode < 300) {
          resolve(response.data)
          return
        }
        const message = response.data && response.data.error
          ? response.data.error
          : `请求失败 (${response.statusCode})`
        const error = new Error(message)
        error.statusCode = response.statusCode
        reject(error)
      },
      fail(error) {
        reject(new Error(error.errMsg || '网络请求失败'))
      },
    })
  })
}

function checkHealth() {
  return request('/mini-health')
}

function getWechatCode() {
  return new Promise((resolve, reject) => {
    wx.login({
      timeout: 10000,
      success(result) {
        if (result.code) resolve(result.code)
        else reject(new Error('微信未返回登录凭证'))
      },
      fail(error) {
        reject(new Error(error.errMsg || '微信登录失败'))
      },
    })
  })
}

async function loginWithWechat() {
  const code = await getWechatCode()
  const session = await request('/wechat-login', {
    method: 'POST',
    data: { code },
  })
  wx.setStorageSync(SESSION_KEY, session)
  return session
}

function loadSession() {
  try {
    const session = wx.getStorageSync(SESSION_KEY) || null
    if (!session || !session.token || !session.expiresAt || Date.parse(session.expiresAt) <= Date.now()) {
      wx.removeStorageSync(SESSION_KEY)
      return null
    }
    return session
  } catch {
    return null
  }
}

async function synchronizeEntries(entries) {
  const session = loadSession()
  if (!session) throw new Error('请先连接微信身份')

  try {
    return await request('/mini-sync', {
      method: 'POST',
      data: {
        entries: entries.map((entry) => ({
          id: entry.id,
          term: entry.term,
          meaning: entry.meaning,
          note: entry.note,
          mastery: entry.mastery,
          createdAt: entry.createdAt,
          updatedAt: entry.updatedAt,
          deletedAt: entry.deletedAt,
        })),
      },
      header: { Authorization: `Bearer ${session.token}` },
      timeout: 30000,
    })
  } catch (error) {
    if (error.statusCode === 401) wx.removeStorageSync(SESSION_KEY)
    throw error
  }
}

async function linkWechatAccount(code) {
  const session = loadSession()
  if (!session) throw new Error('请先连接微信身份')

  try {
    const result = await request('/link-wechat-account', {
      method: 'POST',
      data: { code },
      header: { Authorization: `Bearer ${session.token}` },
      timeout: 30000,
    })
    wx.setStorageSync(SESSION_KEY, { ...session, ownerId: result.ownerId })
    return result
  } catch (error) {
    if (error.statusCode === 401) wx.removeStorageSync(SESSION_KEY)
    throw error
  }
}

async function requestAi(path, data) {
  const session = loadSession()
  if (!session) throw new Error('请先连接微信身份')

  try {
    return await request(path, {
      method: 'POST',
      data,
      header: { Authorization: `Bearer ${session.token}` },
      timeout: 90000,
    })
  } catch (error) {
    if (error.statusCode === 401) wx.removeStorageSync(SESSION_KEY)
    throw error
  }
}

function generatePassage(wordIds, length, provider) {
  return requestAi('/generate-passage', { wordIds, length, provider })
}

function generateReview(wordIds, questionCount, difficulty, provider) {
  return requestAi('/generate-review', { wordIds, questionCount, difficulty, provider })
}

async function generateFlashcards(wordIds, provider) {
  return parseGeneratedFlashcards(await requestAi('/generate-flashcards', { wordIds, provider }))
}

async function sendWordChatMessage(wordId, messages, provider) {
  return parseWordChatResponse(await requestAi('/word-chat', { wordId, messages, provider }))
}

async function generateSpeech(text) {
  const result = await requestAi('/generate-speech', { text })
  if (!result || typeof result.audio !== 'string' || !result.audio) {
    throw new Error('语音服务未返回有效音频')
  }
  return result
}

module.exports = {
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
}
