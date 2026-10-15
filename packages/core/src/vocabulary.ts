import type { SyncStatus, VocabularyEntry } from './types'

export const MASTERY_MIN = 0
export const MASTERY_MAX = 5
export const MAX_TERM_LENGTH = 200
export const MAX_MEANING_LENGTH = 2000
export const MAX_NOTE_LENGTH = 4000
export const MAX_SYNC_ENTRIES = 500
export const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const syncStatuses = new Set<SyncStatus>(['local', 'pending', 'synced', 'conflict'])

export function normalizeTerm(value: string) {
  return value.trim().toLocaleLowerCase()
}

export function clampMastery(value: unknown) {
  const numeric = Number(value)
  return Math.max(MASTERY_MIN, Math.min(MASTERY_MAX, Number.isFinite(numeric) ? numeric : 0))
}

export function isValidTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

export function isLegacyVocabularyEntry(value: unknown): value is Omit<VocabularyEntry, 'ownerId' | 'deletedAt' | 'syncStatus'> {
  if (!value || typeof value !== 'object') return false
  const entry = value as Record<string, unknown>
  return (
    typeof entry.id === 'string' && entry.id.length > 0 &&
    typeof entry.term === 'string' &&
    typeof entry.meaning === 'string' &&
    typeof entry.note === 'string' &&
    Number.isInteger(entry.mastery) && Number(entry.mastery) >= MASTERY_MIN && Number(entry.mastery) <= MASTERY_MAX &&
    isValidTimestamp(entry.createdAt) && isValidTimestamp(entry.updatedAt)
  )
}

export function isVocabularyEntry(value: unknown): value is VocabularyEntry & { ownerId: string | null } {
  if (!isLegacyVocabularyEntry(value)) return false
  const entry = value as unknown as Record<string, unknown>
  return (
    (typeof entry.ownerId === 'string' || entry.ownerId === null || entry.ownerId === undefined) &&
    (entry.deletedAt === null || isValidTimestamp(entry.deletedAt)) &&
    syncStatuses.has(entry.syncStatus as SyncStatus)
  )
}

export function normalizeVocabularyEntry(
  value: unknown,
  createId: () => string,
  now: () => string,
): VocabularyEntry | null {
  if (!value || typeof value !== 'object') return null
  const entry = value as Record<string, unknown>
  if (typeof entry.id !== 'string' || typeof entry.term !== 'string') return null
  const timestamp = now()
  return {
    id: UUID_V4_PATTERN.test(entry.id) ? entry.id : createId(),
    term: entry.term.trim(),
    meaning: typeof entry.meaning === 'string' ? entry.meaning : '',
    note: typeof entry.note === 'string' ? entry.note : '',
    mastery: clampMastery(entry.mastery),
    createdAt: isValidTimestamp(entry.createdAt) ? entry.createdAt : timestamp,
    updatedAt: isValidTimestamp(entry.updatedAt) ? entry.updatedAt : timestamp,
    ownerId: typeof entry.ownerId === 'string' || entry.ownerId === null ? entry.ownerId : undefined,
    deletedAt: isValidTimestamp(entry.deletedAt) ? entry.deletedAt : null,
    syncStatus: syncStatuses.has(entry.syncStatus as SyncStatus) ? entry.syncStatus as SyncStatus : 'local',
  }
}

export function validateSyncEntry(value: unknown) {
  if (!value || typeof value !== 'object') return false
  const entry = value as Record<string, unknown>
  return (
    typeof entry.id === 'string' && UUID_V4_PATTERN.test(entry.id) &&
    typeof entry.term === 'string' && entry.term.trim().length > 0 && entry.term.length <= MAX_TERM_LENGTH &&
    typeof entry.meaning === 'string' && entry.meaning.length <= MAX_MEANING_LENGTH &&
    typeof entry.note === 'string' && entry.note.length <= MAX_NOTE_LENGTH &&
    Number.isInteger(entry.mastery) && Number(entry.mastery) >= MASTERY_MIN && Number(entry.mastery) <= MASTERY_MAX &&
    isValidTimestamp(entry.createdAt) && isValidTimestamp(entry.updatedAt) &&
    (entry.deletedAt === null || isValidTimestamp(entry.deletedAt))
  )
}