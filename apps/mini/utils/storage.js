const STORAGE_KEY = 'wordbook-mini:data:v2'
const LEGACY_STORAGE_KEY = 'wordbook-mini:data:v1'
const CURRENT_VERSION = 2
const { normalizeVocabularyEntry } = require('../vendor/wordbook-core')

function createUuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16)
    const value = character === 'x' ? random : (random & 0x3) | 0x8
    return value.toString(16)
  })
}

function emptyState() {
  return { version: CURRENT_VERSION, entries: [], reviewSchedules: [] }
}

function normalizeEntry(value) {
  return normalizeVocabularyEntry(value, createUuid, () => new Date().toISOString())
}

function readState() {
  try {
    const saved = wx.getStorageSync(STORAGE_KEY)
    if (saved && saved.version === CURRENT_VERSION && Array.isArray(saved.entries)) {
      return {
        version: CURRENT_VERSION,
        entries: saved.entries.map(normalizeEntry).filter(Boolean),
        reviewSchedules: Array.isArray(saved.reviewSchedules) ? saved.reviewSchedules : [],
      }
    }

    const legacy = wx.getStorageSync(LEGACY_STORAGE_KEY)
    if (!legacy || !Array.isArray(legacy.entries)) return emptyState()
    return {
      version: CURRENT_VERSION,
      entries: legacy.entries.map(normalizeEntry).filter(Boolean),
    }
  } catch (error) {
    console.error('读取本地词库失败', error)
    return emptyState()
  }
}

function writeState(state) {
  wx.setStorageSync(STORAGE_KEY, {
    version: CURRENT_VERSION,
    entries: state.entries,
    reviewSchedules: state.reviewSchedules,
  })
}

function initializeStorage() {
  const state = readState()
  writeState(state)
  try {
    wx.removeStorageSync(LEGACY_STORAGE_KEY)
  } catch {
    // The migrated v2 copy is already durable; stale v1 cleanup is best-effort.
  }
  return state
}

function loadEntries() {
  return readState().entries
    .filter((entry) => !entry.deletedAt)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
}

function loadAllEntries() {
  return readState().entries.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
}

function saveEntries(entries) {
  writeState({ ...readState(), entries })
}

function loadReviewSchedules() {
  return readState().reviewSchedules
}

function saveReviewSchedules(reviewSchedules) {
  writeState({ ...readState(), reviewSchedules })
}

function createEntry(values) {
  const now = new Date().toISOString()
  return {
    id: createUuid(),
    term: values.term.trim(),
    meaning: values.meaning.trim(),
    note: values.note.trim(),
    mastery: 0,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    syncStatus: 'pending',
  }
}

module.exports = {
  createEntry,
  initializeStorage,
  loadAllEntries,
  loadEntries,
  loadReviewSchedules,
  saveEntries,
  saveReviewSchedules,
}
