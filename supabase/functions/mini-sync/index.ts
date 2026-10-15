import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const maxEntriesPerSync = 500

type ClientEntry = {
  id: string
  term: string
  meaning: string
  note: string
  mastery: number
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

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

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

async function hashToken(token: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

function validTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

function parseEntry(value: unknown): ClientEntry | null {
  if (!value || typeof value !== 'object') return null
  const entry = value as Record<string, unknown>
  const deletedAt = entry.deletedAt === null ? null : entry.deletedAt
  if (
    typeof entry.id !== 'string' || !uuidPattern.test(entry.id) ||
    typeof entry.term !== 'string' || !entry.term.trim() || entry.term.length > 200 ||
    typeof entry.meaning !== 'string' || entry.meaning.length > 2000 ||
    typeof entry.note !== 'string' || entry.note.length > 4000 ||
    !Number.isInteger(entry.mastery) || Number(entry.mastery) < 0 || Number(entry.mastery) > 5 ||
    !validTimestamp(entry.createdAt) || !validTimestamp(entry.updatedAt) ||
    (deletedAt !== null && !validTimestamp(deletedAt))
  ) return null

  return {
    id: entry.id,
    term: entry.term.trim(),
    meaning: entry.meaning,
    note: entry.note,
    mastery: Number(entry.mastery),
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    deletedAt,
  }
}

function toCloud(entry: ClientEntry, ownerId: string): CloudEntry {
  return {
    id: entry.id,
    user_id: ownerId,
    term: entry.term,
    normalized_term: entry.term.toLocaleLowerCase(),
    meaning: entry.meaning,
    note: entry.note,
    mastery: entry.mastery,
    created_at: entry.createdAt,
    updated_at: entry.updatedAt,
    deleted_at: entry.deletedAt,
  }
}

function toClient(entry: CloudEntry): ClientEntry {
  return {
    id: entry.id,
    term: entry.term,
    meaning: entry.meaning,
    note: entry.note,
    mastery: entry.mastery,
    createdAt: entry.created_at,
    updatedAt: entry.updated_at,
    deletedAt: entry.deleted_at,
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)

  const authorization = request.headers.get('Authorization') || ''
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : ''
  if (!token || token.length > 256) return jsonResponse({ error: '请先连接微信身份' }, 401)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) return jsonResponse({ error: '同步服务尚未完成配置' }, 503)
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const tokenHash = await hashToken(token)
  const { data: session, error: sessionError } = await admin
    .from('mini_sessions')
    .select('user_id, expires_at')
    .eq('token_hash', tokenHash)
    .maybeSingle()
  if (sessionError) {
    console.error('mini session lookup failed', sessionError)
    return jsonResponse({ error: '验证微信会话失败' }, 500)
  }
  if (!session || Date.parse(session.expires_at) <= Date.now()) {
    return jsonResponse({ error: '微信会话已失效，请重新连接' }, 401)
  }

  const { data: identity, error: identityError } = await admin
    .from('wechat_identities')
    .select('owner_id')
    .eq('user_id', session.user_id)
    .single()
  if (identityError || !identity) {
    console.error('wechat owner lookup failed', identityError)
    return jsonResponse({ error: '读取微信身份失败' }, 500)
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return jsonResponse({ error: '请求格式不正确' }, 400)
  }
  const rawEntries = body && typeof body === 'object'
    ? (body as Record<string, unknown>).entries
    : null
  if (!Array.isArray(rawEntries) || rawEntries.length > maxEntriesPerSync) {
    return jsonResponse({ error: `单次最多同步 ${maxEntriesPerSync} 个词条` }, 422)
  }
  const entries = rawEntries.map(parseEntry)
  if (entries.some((entry) => entry === null)) {
    return jsonResponse({ error: '词条数据格式不正确' }, 422)
  }
  const clientEntries = entries as ClientEntry[]
  if (new Set(clientEntries.map((entry) => entry.id)).size !== clientEntries.length) {
    return jsonResponse({ error: '请求中包含重复词条' }, 422)
  }

  if (clientEntries.length) {
    const { data: collisions, error: collisionError } = await admin
      .from('vocabulary_entries')
      .select('id, user_id')
      .in('id', clientEntries.map((entry) => entry.id))
    if (collisionError) {
      console.error('entry ownership check failed', collisionError)
      return jsonResponse({ error: '检查词条归属失败' }, 500)
    }
    if ((collisions ?? []).some((entry) => entry.user_id !== identity.owner_id)) {
      return jsonResponse({ error: '检测到无权修改的词条' }, 403)
    }
  }

  const { data: currentRows, error: pullError } = await admin
    .from('vocabulary_entries')
    .select('*')
    .eq('user_id', identity.owner_id)
  if (pullError) {
    console.error('mini sync pull failed', pullError)
    return jsonResponse({ error: '读取云端词条失败' }, 500)
  }

  const currentById = new Map((currentRows as CloudEntry[] | null ?? []).map((entry) => [entry.id, entry]))
  const toUpload = clientEntries.filter((entry) => {
    const remote = currentById.get(entry.id)
    return !remote || entry.updatedAt > remote.updated_at
  })
  if (toUpload.length) {
    const { error: pushError } = await admin
      .from('vocabulary_entries')
      .upsert(toUpload.map((entry) => toCloud(entry, identity.owner_id)), { onConflict: 'id' })
    if (pushError) {
      console.error('mini sync push failed', pushError)
      return jsonResponse({ error: '上传本地词条失败' }, 500)
    }
  }

  const { data: mergedRows, error: mergedError } = await admin
    .from('vocabulary_entries')
    .select('*')
    .eq('user_id', identity.owner_id)
    .order('updated_at', { ascending: false })
  if (mergedError) {
    console.error('mini sync result pull failed', mergedError)
    return jsonResponse({ error: '读取同步结果失败' }, 500)
  }

  await admin
    .from('mini_sessions')
    .update({ last_seen_at: new Date().toISOString() })
    .eq('token_hash', tokenHash)

  return jsonResponse({
    entries: (mergedRows as CloudEntry[] | null ?? []).map(toClient),
    uploadedCount: toUpload.length,
    serverTime: new Date().toISOString(),
  })
})
