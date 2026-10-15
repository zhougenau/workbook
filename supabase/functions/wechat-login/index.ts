import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const sessionLifetimeMs = 30 * 24 * 60 * 60 * 1000

type WechatSessionResponse = {
  openid?: string
  unionid?: string
  session_key?: string
  errcode?: number
  errmsg?: string
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function createToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

async function hashToken(token: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

async function exchangeCode(code: string, appId: string, appSecret: string) {
  const url = new URL('https://api.weixin.qq.com/sns/jscode2session')
  url.searchParams.set('appid', appId)
  url.searchParams.set('secret', appSecret)
  url.searchParams.set('js_code', code)
  url.searchParams.set('grant_type', 'authorization_code')

  const response = await fetch(url)
  if (!response.ok) throw new Error(`微信身份服务请求失败 (${response.status})`)
  return await response.json() as WechatSessionResponse
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)

  const appId = Deno.env.get('WECHAT_APP_ID')
  const appSecret = Deno.env.get('WECHAT_APP_SECRET')
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!appId || !appSecret || !supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: '微信登录服务尚未完成配置' }, 503)
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return jsonResponse({ error: '请求格式不正确' }, 400)
  }
  const code = body && typeof body === 'object' ? (body as Record<string, unknown>).code : null
  if (typeof code !== 'string' || !code.trim() || code.length > 256) {
    return jsonResponse({ error: '微信登录凭证无效' }, 422)
  }

  let wechatSession: WechatSessionResponse
  try {
    wechatSession = await exchangeCode(code, appId, appSecret)
  } catch (error) {
    console.error('jscode2session request failed', error)
    return jsonResponse({ error: '暂时无法连接微信身份服务' }, 502)
  }

  if (!wechatSession.openid) {
    console.error('jscode2session rejected', wechatSession.errcode, wechatSession.errmsg)
    return jsonResponse({ error: '微信登录凭证已失效，请重试' }, 401)
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const now = new Date()
  const identityValues: Record<string, string> = {
    appid: appId,
    openid: wechatSession.openid,
    last_login_at: now.toISOString(),
  }
  if (wechatSession.unionid) identityValues.unionid = wechatSession.unionid

  const { data: identity, error: identityError } = await admin
    .from('wechat_identities')
    .upsert(identityValues, { onConflict: 'appid,openid' })
    .select('user_id, owner_id')
    .single()
  if (identityError || !identity) {
    console.error('wechat identity upsert failed', identityError)
    return jsonResponse({ error: '保存微信身份失败' }, 500)
  }

  const token = createToken()
  const tokenHash = await hashToken(token)
  const expiresAt = new Date(now.getTime() + sessionLifetimeMs)
  await admin.from('mini_sessions').delete().lt('expires_at', now.toISOString())
  const { error: sessionError } = await admin.from('mini_sessions').insert({
    token_hash: tokenHash,
    user_id: identity.user_id,
    expires_at: expiresAt.toISOString(),
  })
  if (sessionError) {
    console.error('mini session insert failed', sessionError)
    return jsonResponse({ error: '创建登录会话失败' }, 500)
  }

  return jsonResponse({
    token,
    userId: identity.user_id,
    ownerId: identity.owner_id,
    expiresAt: expiresAt.toISOString(),
  })
})
