import type { User } from '@supabase/supabase-js'
import { mergeEntriesLastWriteWins, normalizeTerm, reconcileDuplicateTerms } from '@wordbook/core'
import { db, loadReviewSchedules, type StoredReviewSchedule, type VocabularyEntry } from './storage'
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

// The reconcileDuplicateTerms function has been moved to '@wordbook/core' and is now imported.

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
    normalized_term: normalizeTerm(entry.term),
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

  const remoteEntries = ((data ?? []) as CloudEntry[]).map(fromCloud)
  let mergedEntries = reconcileDuplicateTerms(
    mergeEntriesLastWriteWins(ownedLocal, remoteEntries),
    user.id,
    new Date().toISOString(),
  ) as VocabularyEntry[]
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

  const activeIds = new Set(mergedEntries.filter((entry) => !entry.deletedAt).map((entry) => entry.id))
  const localSchedules = await loadReviewSchedules(user.id)
  const remapped = localSchedules.map((schedule) => ({
    ...schedule,
    wordId: idRemap[schedule.wordId] ?? schedule.wordId,
  })).filter((schedule) => activeIds.has(schedule.wordId))
  const schedulesById = new Map<string, StoredReviewSchedule>()
  for (const schedule of remapped) {
    const previous = schedulesById.get(schedule.wordId)
    if (!previous || Date.parse(schedule.updatedAt) > Date.parse(previous.updatedAt)) schedulesById.set(schedule.wordId, schedule)
  }
  const schedules = [...schedulesById.values()]
  const remoteSchedules = new Map<string, StoredReviewSchedule>()
  const accessToken = await getAccessToken()
  for (let index = 0; index < schedules.length || index === 0; index += 500) {
    const { data: result, error } = await supabase.functions.invoke('review-sync', {
      body: { schedules: schedules.slice(index, index + 500) },
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (error) throw createSyncError('同步复习进度', error)
    for (const schedule of result.schedules as StoredReviewSchedule[]) {
      if (activeIds.has(schedule.wordId)) remoteSchedules.set(schedule.wordId, { ...schedule, ownerId: user.id, syncStatus: 'synced' })
    }
  }
  await db.transaction('rw', db.reviewSchedules, async () => {
    await db.reviewSchedules.bulkDelete(Object.keys(idRemap))
    const latestLocal = await db.reviewSchedules.bulkGet([...remoteSchedules.keys()])
    const merged = [...remoteSchedules.values()].map((schedule, index) => {
      const local = latestLocal[index]
      return local && Date.parse(local.updatedAt) > Date.parse(schedule.updatedAt) ? local : schedule
    })
    await db.reviewSchedules.bulkPut(merged)
  })

  return { idRemap, repairedCount: Object.keys(idRemap).length }
}

export function synchronize(user: User): Promise<SyncResult> {
  const activeSync = syncInFlight.get(user.id)
  if (activeSync) return activeSync

  const sync = synchronizeOnce(user).finally(() => syncInFlight.delete(user.id))
  syncInFlight.set(user.id, sync)
  return sync
}