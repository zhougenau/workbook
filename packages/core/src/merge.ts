import type { VocabularyEntry } from './types'
import { normalizeTerm } from './vocabulary'

export function mergeEntriesLastWriteWins(local: VocabularyEntry[], remote: VocabularyEntry[]) {
  const merged = new Map<string, VocabularyEntry>()
  for (const entry of local) merged.set(entry.id, entry)
  for (const entry of remote) {
    const current = merged.get(entry.id)
    if (!current || entry.updatedAt > current.updatedAt) merged.set(entry.id, entry)
  }
  return [...merged.values()]
}

export function reconcileDuplicateTerms(entries: VocabularyEntry[], ownerId: string, deletedAt: string) {
  const keepByTerm = new Map<string, VocabularyEntry>()
  for (const entry of entries) {
    if (entry.deletedAt) continue
    const key = normalizeTerm(entry.term)
    const current = keepByTerm.get(key)
    if (!current || entry.updatedAt > current.updatedAt) keepByTerm.set(key, entry)
  }
  const keepIds = new Set([...keepByTerm.values()].map((entry) => entry.id))
  return entries.map((entry) => (
    !entry.deletedAt && !keepIds.has(entry.id)
      ? { ...entry, ownerId, deletedAt, updatedAt: deletedAt, syncStatus: 'pending' as const }
      : entry
  ))
}