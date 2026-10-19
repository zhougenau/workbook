import { resolveOwner } from '../_shared/resolve-owner.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'GET') return jsonResponse({ error: 'Method not allowed' }, 405)

  const authorization = request.headers.get('Authorization')
  if (!authorization) return jsonResponse({ error: '请先登录后查看 AI 用量' }, 401)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !anonKey || !serviceRoleKey) return jsonResponse({ error: 'AI 用量服务尚未完成配置' }, 503)

  try {
    const owner = await resolveOwner(authorization, supabaseUrl, anonKey, serviceRoleKey)
    if (!owner) return jsonResponse({ error: '登录已失效，请重新登录' }, 401)

    const now = new Date()
    const day = now.toISOString().slice(0, 10)
    const [daily, recentText, recentSpeech, active] = await Promise.all([
      owner.admin.from('paid_budget_days')
        .select('reserved_text_tokens, actual_text_tokens, reserved_speech_chars, actual_speech_chars')
        .eq('owner_id', owner.ownerId).eq('usage_day', day).maybeSingle(),
      owner.admin.from('paid_budget_requests')
        .select('request_id', { count: 'exact', head: true })
        .eq('owner_id', owner.ownerId).eq('resource', 'text').gt('admitted_at', new Date(now.getTime() - 60_000).toISOString()),
      owner.admin.from('paid_budget_requests')
        .select('request_id', { count: 'exact', head: true })
        .eq('owner_id', owner.ownerId).eq('resource', 'speech').gt('admitted_at', new Date(now.getTime() - 60_000).toISOString()),
      owner.admin.from('paid_budget_leases')
        .select('lease_id', { count: 'exact', head: true })
        .eq('owner_id', owner.ownerId).gt('expires_at', now.toISOString()),
    ])
    if (daily.error || recentText.error || recentSpeech.error || active.error) return jsonResponse({ error: '读取 AI 用量失败' }, 500)

    return jsonResponse({
      day,
      text: { used: Number(daily.data?.actual_text_tokens ?? 0), reserved: Number(daily.data?.reserved_text_tokens ?? 0), limit: 100_000 },
      speech: { used: Number(daily.data?.actual_speech_chars ?? 0), reserved: Number(daily.data?.reserved_speech_chars ?? 0), limit: 30_000 },
      requests: { used: recentText.count ?? 0, limit: 10 },
      speechRequests: { used: recentSpeech.count ?? 0, limit: 60 },
      concurrent: { used: active.count ?? 0, limit: 2 },
    })
  } catch (error) {
    console.error('AI usage lookup failed', error)
    return jsonResponse({ error: '读取 AI 用量失败' }, 500)
  }
})