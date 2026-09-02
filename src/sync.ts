import type { User } from '@supabase/supabase-js'
import { db, type VocabularyEntry } from './storage'
import { getAccessToken, supabase } from './supabase'
import { createSyncError } from './syncError'

type CloudEntry = {
  id: string
  user_id: string
  term: string
  normalized_term: string
  meaning: string
  note: string
  mastery: number
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export type SyncResult = {
  idRemap: Record<string, string>
  repairedCount: number
}

type PostgrestErrorLike = {
  code?: unknown
  message?: unknown
}

const syncInFlight = new Map<string, Promise<SyncResult>>()

function isOwnershipCollision(error: unknown) {
  if (!error || typeof error !== 'object') return false
  const details = error as PostgrestErrorLike
  return String(details.code) === '42501' && /USING expression/i.test(String(details.message))
}

function reconcileDuplicateTerms(entries: VocabularyEntry[], userId: string) {
  const keepByTerm = new Map<string, VocabularyEntry>()
  for (const entry of entries) {
    if (entry.deletedAt) continue
    const normalizedTerm = entry.term.trim().toLocaleLowerCase()
    const current = keepByTerm.get(normalizedTerm)
    if (!current || entry.updatedAt > current.updatedAt) keepByTerm.set(normalizedTerm, entry)
  }

  const keepIds = new Set([...keepByTerm.values()].map((entry) => entry.id))
  const deletedAt = new Date().toISOString()
  return entries.map((entry) => (
    !entry.deletedAt && !keepIds.has(entry.id)
      ? { ...entry, ownerId: userId, deletedAt, updatedAt: deletedAt, syncStatus: 'pending' as const }
      : entry
  ))
}

function fromCloud(row: CloudEntry): VocabularyEntry {
  return {
    id: row.id,
    term: row.term,
    meaning: row.meaning,
    note: row.note,
    mastery: row.mastery,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ownerId: row.user_id,
    deletedAt: row.deleted_at,
    syncStatus: 'synced',
  }
}

function toCloud(entry: VocabularyEntry, userId: string): CloudEntry {
  return {
    id: entry.id,
    user_id: userId,
    term: entry.term,
    normalized_term: entry.term.trim().toLocaleLowerCase(),
    meaning: entry.meaning,
    note: entry.note,
    mastery: entry.mastery,
    created_at: entry.createdAt,
    updated_at: entry.updatedAt,
    deleted_at: entry.deletedAt,
  }
}

async function synchronizeOnce(user: User): Promise<SyncResult> {
  if (!supabase) throw new Error('尚未配置 Supabase')
  try {
    await getAccessToken()
  } catch (error) {
    throw createSyncError('验证登录状态', error)
  }

  let allLocal: VocabularyEntry[]
  try {
    allLocal = await db.entries.toArray()
  } catch (error) {
    throw createSyncError('读取本地词条', error)
  }
  const ownedLocal = allLocal
    .filter((entry) => entry.ownerId === user.id || entry.ownerId === null)
    .map((entry) => ({
      ...entry,
      ownerId: user.id,
      syncStatus: entry.syncStatus === 'synced' ? 'synced' as const : 'pending' as const,
    }))

  const { data, error: pullError } = await supabase
    .from('vocabulary_entries')
    .select('*')
    .eq('user_id', user.id)
  if (pullError) throw createSyncError('下载云端词条', pullError)

  const merged = new Map<string, VocabularyEntry>()
  for (const entry of ownedLocal) merged.set(entry.id, entry)
  for (const row of (data ?? []) as CloudEntry[]) {
    const remote = fromCloud(row)
    const local = merged.get(remote.id)
    if (!local || remote.updatedAt > local.updatedAt) merged.set(remote.id, remote)
  }

  let mergedEntries = reconcileDuplicateTerms([...merged.values()], user.id)
  let toUpload = mergedEntries.filter((entry) => entry.syncStatus !== 'synced')
  const idRemap: Record<string, string> = {}
  if (toUpload.length) {
    let { error: pushError } = await supabase
      .from('vocabulary_entries')
      .upsert(toUpload.map((entry) => toCloud(entry, user.id)), { onConflict: 'id' })

    if (pushError && isOwnershipCollision(pushError)) {
      const remoteIds = new Set((data ?? []).map((row) => (row as CloudEntry).id))
      const collisionCandidates = toUpload.filter((entry) => !remoteIds.has(entry.id))
      const candidateIds = new Set(collisionCandidates.map((entry) => entry.id))
      const repairedAt = new Date().toISOString()
      const repairedEntries = collisionCandidates
        .filter((entry) => !entry.deletedAt)
        .map((entry) => {
          const repairedId = crypto.randomUUID()
          idRemap[entry.id] = repairedId
          return { ...entry, id: repairedId, updatedAt: repairedAt }
        })

      if (collisionCandidates.length) {
        try {
          await db.transaction('rw', db.entries, async () => {
            await db.entries.bulkDelete([...candidateIds])
            await db.entries.bulkPut(repairedEntries)
          })
        } catch (error) {
          throw createSyncError('保存同步结果', error)
        }

        mergedEntries = [
          ...mergedEntries.filter((entry) => !candidateIds.has(entry.id)),
          ...repairedEntries,
        ]
        toUpload = [
          ...toUpload.filter((entry) => remoteIds.has(entry.id)),
          ...repairedEntries,
        ]
        const retry = await supabase
          .from('vocabulary_entries')
          .upsert(toUpload.map((entry) => toCloud(entry, user.id)), { onConflict: 'id' })
        pushError = retry.error
      }
    }

    if (pushError) throw createSyncError('上传本地词条', pushError, toUpload.length)
  }

  try {
    await db.entries.bulkPut(
      mergedEntries.map((entry) => ({ ...entry, ownerId: user.id, syncStatus: 'synced' })),
    )
  } catch (error) {
    throw createSyncError('保存同步结果', error)
  }

  return { idRemap, repairedCount: Object.keys(idRemap).length }
}

export function synchronize(user: User): Promise<SyncResult> {
  const activeSync = syncInFlight.get(user.id)
  if (activeSync) return activeSync

  const sync = synchronizeOnce(user).finally(() => syncInFlight.delete(user.id))
  syncInFlight.set(user.id, sync)
  return sync
}