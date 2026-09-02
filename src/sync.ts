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

export async function synchronize(user: User) {
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

  const mergedEntries = [...merged.values()]
  const toUpload = mergedEntries.filter((entry) => entry.syncStatus !== 'synced')
  if (toUpload.length) {
    const { error: pushError } = await supabase
      .from('vocabulary_entries')
      .upsert(toUpload.map((entry) => toCloud(entry, user.id)), { onConflict: 'id' })
    if (pushError) throw createSyncError('上传本地词条', pushError, toUpload.length)
  }

  try {
    await db.entries.bulkPut(
      mergedEntries.map((entry) => ({ ...entry, ownerId: user.id, syncStatus: 'synced' })),
    )
  } catch (error) {
    throw createSyncError('保存同步结果', error)
  }
}