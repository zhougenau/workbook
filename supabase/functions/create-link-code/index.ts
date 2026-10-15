import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const codeAlphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'
const codeLifetimeMs = 10 * 60 * 1000

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function createCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(8))
  const raw = Array.from(bytes, (byte) => codeAlphabet[byte % codeAlphabet.length]).join('')
  return `${raw.slice(0, 4)}-${raw.slice(4)}`
}

async function hashCode(code: string) {
  const normalized = code.replace(/[^A-Z0-9]/g, '').toUpperCase()
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalized))
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)

  const authorization = request.headers.get('Authorization')
  if (!authorization) return jsonResponse({ error: '请先登录 Web 词屿' }, 401)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return jsonResponse({ error: '账号绑定服务尚未完成配置' }, 503)
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: userData, error: userError } = await userClient.auth.getUser()
  if (userError || !userData.user) return jsonResponse({ error: 'Web 登录已失效，请重新登录' }, 401)

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  await admin.from('account_link_codes').delete().eq('auth_user_id', userData.user.id)

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const code = createCode()
    const codeHash = await hashCode(code)
    const expiresAt = new Date(Date.now() + codeLifetimeMs).toISOString()
    const { error } = await admin.from('account_link_codes').insert({
      code_hash: codeHash,
      auth_user_id: userData.user.id,
      expires_at: expiresAt,
    })
    if (!error) return jsonResponse({ code, expiresAt })
    if (error.code !== '23505') {
      console.error('link code insert failed', error)
      return jsonResponse({ error: '创建绑定码失败' }, 500)
    }
  }

  return jsonResponse({ error: '暂时无法生成唯一绑定码，请重试' }, 503)
})
