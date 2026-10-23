import Dexie, { type Table } from 'dexie'
import {
  isLegacyVocabularyEntry,
  isVocabularyEntry,
  type ReviewSchedule,
  type VocabularyEntry as CoreVocabularyEntry,
} from '@wordbook/core'

export type SyncStatus = 'local' | 'pending' | 'synced' | 'conflict'

export type VocabularyEntry = CoreVocabularyEntry & { ownerId: string | null; syncStatus: SyncStatus }
export type StoredReviewSchedule = ReviewSchedule & { ownerId: string | null; syncStatus: SyncStatus }

const LEGACY_STORAGE_KEY = 'wordbook.entries.v1'
const MIGRATION_KEY = 'wordbook.dexie.migrated'

class WordbookDatabase extends Dexie {
  entries!: Table<VocabularyEntry, string>
  reviewSchedules!: Table<StoredReviewSchedule, string>

  constructor() {
    super('wordbook')
    this.version(1).stores({
      entries: '&id, term, ownerId, updatedAt, deletedAt, syncStatus',
    })
    this.version(2).stores({
      entries: '&id, term, ownerId, updatedAt, deletedAt, syncStatus',
      reviewSchedules: '&wordId, ownerId, updatedAt, syncStatus',
    })
  }
}

export const db = new WordbookDatabase()

export async function loadReviewSchedules(ownerId: string | null) {
  return (await db.reviewSchedules.toArray()).filter((schedule) => schedule.ownerId === ownerId || schedule.ownerId === null)
}

export async function saveReviewSchedule(schedule: StoredReviewSchedule) {
  await db.reviewSchedules.put(schedule)
}

export async function initializeStorage() {
  if (localStorage.getItem(MIGRATION_KEY)) return

  try {
    const saved = localStorage.getItem(LEGACY_STORAGE_KEY)
    const parsed: unknown = saved ? JSON.parse(saved) : []
    if (Array.isArray(parsed)) {
      const migrated = parsed.filter(isLegacyVocabularyEntry).map((entry) => ({
        ...entry,
        ownerId: null,
        deletedAt: null,
        syncStatus: 'local' as const,
      }))
      if (migrated.length) await db.entries.bulkPut(migrated)
    }
    localStorage.setItem(MIGRATION_KEY, new Date().toISOString())
  } catch {
    // A malformed legacy backup must not prevent the new database from opening.
  }
}

export async function loadEntries(ownerId: string | null = null) {
  const entries = await db.entries.toArray()
  return entries.filter(
    (entry) => !entry.deletedAt && (entry.ownerId === ownerId || entry.ownerId === null),
  )
}

export async function saveEntry(entry: VocabularyEntry) {
  await db.entries.put(entry)
}

export async function saveEntries(entries: VocabularyEntry[]) {
  await db.entries.bulkPut(entries)
}

export async function deleteEntry(id: string, ownerId: string | null) {
  const entry = await db.entries.get(id)
  if (!entry) return

  if (!ownerId && !entry.ownerId) {
    await db.entries.delete(id)
    return
  }

  const now = new Date().toISOString()
  await db.entries.put({
    ...entry,
    ownerId: ownerId ?? entry.ownerId,
    deletedAt: now,
    updatedAt: now,
    syncStatus: 'pending',
  })
}

export async function deleteEntries(ids: string[], ownerId: string | null) {
  if (!ids.length) return

  await db.transaction('rw', db.entries, async () => {
    if (!ownerId) {
      await db.entries.bulkDelete(ids)
      return
    }

    const now = new Date().toISOString()
    const existing = (await db.entries.bulkGet(ids)).filter(
      (entry): entry is VocabularyEntry => Boolean(entry),
    )
    await db.entries.bulkPut(existing.map((entry) => ({
      ...entry,
      ownerId,
      deletedAt: now,
      updatedAt: now,
      syncStatus: 'pending',
    })))
  })
}

export async function replaceEntries(entries: VocabularyEntry[]) {
  await db.transaction('rw', db.entries, async () => {
    await db.entries.clear()
    await db.entries.bulkPut(entries)
  })
}

export function parseBackup(contents: string): VocabularyEntry[] {
  const parsed: unknown = JSON.parse(contents)
  if (!Array.isArray(parsed)) throw new Error('备份文件格式不正确')

  return parsed.map((value) => {
    if (isVocabularyEntry(value)) return value
    if (isLegacyVocabularyEntry(value)) {
      return { ...value, ownerId: null, deletedAt: null, syncStatus: 'local' }
    }
    throw new Error('备份文件格式不正确')
  })
}