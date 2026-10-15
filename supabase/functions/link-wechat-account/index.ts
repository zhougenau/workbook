import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

async function hashValue(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)

  const authorization = request.headers.get('Authorization') || ''
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : ''
  if (!token || token.length > 256) return jsonResponse({ error: '请先连接微信身份' }, 401)

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return jsonResponse({ error: '请求格式不正确' }, 400)
  }
  const suppliedCode = body && typeof body === 'object'
    ? (body as Record<string, unknown>).code
    : null
  const normalizedCode = typeof suppliedCode === 'string'
    ? suppliedCode.replace(/[^A-Z0-9]/gi, '').toUpperCase()
    : ''
  if (!/^[2-9A-HJ-NP-Z]{8}$/.test(normalizedCode)) {
    return jsonResponse({ error: '请输入 Web 端生成的 8 位绑定码' }, 422)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) return jsonResponse({ error: '账号绑定服务尚未完成配置' }, 503)
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const tokenHash = await hashValue(token)
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

  const codeHash = await hashValue(normalizedCode)
  const { data, error } = await admin.rpc('link_wechat_owner', {
    p_identity_user_id: session.user_id,
    p_code_hash: codeHash,
  })
  if (error) {
    if (/LINK_CODE_INVALID/.test(error.message)) {
      return jsonResponse({ error: '绑定码无效、已使用或已过期' }, 409)
    }
    console.error('wechat account link failed', error)
    return jsonResponse({ error: '合并 Web 与微信词库失败' }, 500)
  }

  return jsonResponse({
    linked: true,
    ownerId: data.ownerId,
    movedCount: data.movedCount,
    mergedCount: data.mergedCount,
  })
})
