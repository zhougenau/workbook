import { resolveOwner } from '../_shared/resolve-owner.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

type Schedule = {
  wordId: string
  dueAt: string
  intervalDays: number
  streak: number
  lastReviewedAt: string
  updatedAt: string
}

function parseSchedule(value: unknown): Schedule | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  if (typeof row.wordId !== 'string' || !uuidPattern.test(row.wordId)
    || typeof row.dueAt !== 'string' || !Number.isFinite(Date.parse(row.dueAt))
    || typeof row.lastReviewedAt !== 'string' || !Number.isFinite(Date.parse(row.lastReviewedAt))
    || typeof row.updatedAt !== 'string' || !Number.isFinite(Date.parse(row.updatedAt))
    || !Number.isInteger(row.intervalDays) || Number(row.intervalDays) < 0 || Number(row.intervalDays) > 30
    || !Number.isInteger(row.streak) || Number(row.streak) < 0 || Number(row.streak) > 5) return null
  return row as Schedule
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !anonKey || !serviceRoleKey) return jsonResponse({ error: '同步服务未配置' }, 503)

  try {
    const owner = await resolveOwner(request.headers.get('Authorization') || '', supabaseUrl, anonKey, serviceRoleKey)
    if (!owner) return jsonResponse({ error: '请先登录' }, 401)
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return jsonResponse({ error: '请求格式不正确' }, 400)
    }
    const rawSchedules = body && typeof body === 'object' ? (body as { schedules?: unknown }).schedules : null
    if (!Array.isArray(rawSchedules) || rawSchedules.length > 500) return jsonResponse({ error: '复习数据格式不正确' }, 422)
    const schedules = rawSchedules.map(parseSchedule)
    if (schedules.some((schedule) => !schedule)) return jsonResponse({ error: '复习数据格式不正确' }, 422)
    const incoming = schedules as Schedule[]
    if (new Set(incoming.map((schedule) => schedule.wordId)).size !== incoming.length) return jsonResponse({ error: '重复的词条' }, 422)

    if (incoming.length) {
      const { data: words, error: wordError } = await owner.admin.from('vocabulary_entries')
        .select('id, user_id, deleted_at').in('id', incoming.map((schedule) => schedule.wordId))
      if (wordError) throw wordError
      if (words?.length !== incoming.length || words.some((word) => word.user_id !== owner.ownerId || word.deleted_at)) {
        return jsonResponse({ error: '复习词条不属于当前用户' }, 403)
      }
    }

    if (incoming.length) {
      const { error } = await owner.admin.rpc('merge_review_schedules', { p_owner_id: owner.ownerId, p_schedules: incoming })
      if (error) throw error
    }
    const { data, error } = await owner.admin.from('review_schedules').select('*').eq('owner_id', owner.ownerId)
    if (error) throw error
    return jsonResponse({ schedules: (data ?? []).map((row) => ({
      wordId: row.word_id,
      dueAt: row.due_at,
      intervalDays: row.interval_days,
      streak: row.streak,
      lastReviewedAt: row.last_reviewed_at,
      updatedAt: row.updated_at,
    })) })
  } catch (error) {
    console.error('review sync failed', error)
    return jsonResponse({ error: '同步复习进度失败' }, 500)
  }
})