import Dexie, { type Table } from 'dexie'

export type SyncStatus = 'local' | 'pending' | 'synced' | 'conflict'

export type VocabularyEntry = {
  id: string
  term: string
  meaning: string
  note: string
  mastery: number
  createdAt: string
  updatedAt: string
  ownerId: string | null
  deletedAt: string | null
  syncStatus: SyncStatus
}

type LegacyEntry = Omit<VocabularyEntry, 'ownerId' | 'deletedAt' | 'syncStatus'>

const LEGACY_STORAGE_KEY = 'wordbook.entries.v1'
const MIGRATION_KEY = 'wordbook.dexie.migrated'

class WordbookDatabase extends Dexie {
  entries!: Table<VocabularyEntry, string>

  constructor() {
    super('wordbook')
    this.version(1).stores({
      entries: '&id, term, ownerId, updatedAt, deletedAt, syncStatus',
    })
  }
}

export const db = new WordbookDatabase()

function isLegacyEntry(value: unknown): value is LegacyEntry {
  if (!value || typeof value !== 'object') return false
  const entry = value as Record<string, unknown>
  return (
    typeof entry.id === 'string' &&
    typeof entry.term === 'string' &&
    typeof entry.meaning === 'string' &&
    typeof entry.note === 'string' &&
    typeof entry.mastery === 'number' &&
    entry.mastery >= 0 &&
    entry.mastery <= 5 &&
    typeof entry.createdAt === 'string' &&
    typeof entry.updatedAt === 'string'
  )
}

function isVocabularyEntry(value: unknown): value is VocabularyEntry {
  if (!isLegacyEntry(value)) return false
  const entry = value as unknown as Record<string, unknown>
  return (
    (typeof entry.ownerId === 'string' || entry.ownerId === null) &&
    (typeof entry.deletedAt === 'string' || entry.deletedAt === null) &&
    ['local', 'pending', 'synced', 'conflict'].includes(String(entry.syncStatus))
  )
}

export async function initializeStorage() {
  if (localStorage.getItem(MIGRATION_KEY)) return

  try {
    const saved = localStorage.getItem(LEGACY_STORAGE_KEY)
    const parsed: unknown = saved ? JSON.parse(saved) : []
    if (Array.isArray(parsed)) {
      const migrated = parsed.filter(isLegacyEntry).map((entry) => ({
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
    if (isLegacyEntry(value)) {
      return { ...value, ownerId: null, deletedAt: null, syncStatus: 'local' }
    }
    throw new Error('备份文件格式不正确')
  })
}