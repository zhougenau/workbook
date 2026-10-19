import { resolveOwner } from '../_shared/resolve-owner.ts'
import { BudgetExceededError, withPaidBudget } from '../_shared/paid-budget.ts'

const endpoint = 'https://tts.tencentcloudapi.com'
const host = 'tts.tencentcloudapi.com'
const service = 'tts'
const action = 'TextToVoice'
const version = '2019-08-23'
const algorithm = 'TC3-HMAC-SHA256'
const encoder = new TextEncoder()

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

function parseRequest(value: unknown) {
  if (!value || typeof value !== 'object') return null
  const text = typeof (value as Record<string, unknown>).text === 'string'
    ? (value as Record<string, unknown>).text.trim()
    : ''
  if (!text || text.length > 500) return null
  return { text }
}

async function sha256(value: string) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)))
}

function toHex(value: Uint8Array) {
  return Array.from(value).map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function hmac(key: Uint8Array, value: string) {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  return new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(value)))
}

async function createAuthorization(secretId: string, secretKey: string, timestamp: number, payload: string) {
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10)
  const canonicalHeaders = `content-type:application/json; charset=utf-8\nhost:${host}\nx-tc-action:${action.toLowerCase()}\n`
  const signedHeaders = 'content-type;host;x-tc-action'
  const hashedPayload = toHex(await sha256(payload))
  const canonicalRequest = `POST\n/\n\n${canonicalHeaders}\n${signedHeaders}\n${hashedPayload}`
  const credentialScope = `${date}/${service}/tc3_request`
  const stringToSign = `${algorithm}\n${timestamp}\n${credentialScope}\n${toHex(await sha256(canonicalRequest))}`
  const secretDate = await hmac(encoder.encode(`TC3${secretKey}`), date)
  const secretService = await hmac(secretDate, service)
  const secretSigning = await hmac(secretService, 'tc3_request')
  const signature = toHex(await hmac(secretSigning, stringToSign))
  return `${algorithm} Credential=${secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)

  const authorization = request.headers.get('Authorization')
  if (!authorization) return jsonResponse({ error: '请先登录后再使用发音' }, 401)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const secretId = Deno.env.get('TENCENT_TTS_SECRET_ID')
  const secretKey = Deno.env.get('TENCENT_TTS_SECRET_KEY')
  const region = Deno.env.get('TENCENT_TTS_REGION') || 'ap-guangzhou'
  const voiceType = Number(Deno.env.get('TENCENT_TTS_VOICE_TYPE') || '101050')
  if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey || !secretId || !secretKey) {
    return jsonResponse({ error: '语音服务尚未完成配置' }, 503)
  }

  let owner
  try {
    owner = await resolveOwner(authorization, supabaseUrl, supabaseAnonKey, serviceRoleKey)
  } catch (error) {
    console.error('speech owner lookup failed', error)
    return jsonResponse({ error: '验证登录身份失败' }, 500)
  }
  if (!owner) return jsonResponse({ error: '登录已失效，请重新登录' }, 401)

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return jsonResponse({ error: '请求格式不正确' }, 400)
  }
  const speechRequest = parseRequest(body)
  if (!speechRequest) return jsonResponse({ error: '发音文本不能为空且最多 500 个英文字符' }, 422)

  const payload = JSON.stringify({
    Text: speechRequest.text,
    SessionId: crypto.randomUUID(),
    Volume: 0,
    Speed: -1,
    ProjectId: 0,
    ModelType: 1,
    VoiceType: Number.isInteger(voiceType) ? voiceType : 101050,
    PrimaryLanguage: 2,
    SampleRate: 16000,
    Codec: 'mp3',
  })
  const timestamp = Math.floor(Date.now() / 1000)

  try {
    return await withPaidBudget(owner, 'speech', encoder.encode(speechRequest.text).length, async () => {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: await createAuthorization(secretId, secretKey, timestamp, payload),
          'Content-Type': 'application/json; charset=utf-8',
          Host: host,
          'X-TC-Action': action,
          'X-TC-Version': version,
          'X-TC-Timestamp': String(timestamp),
          'X-TC-Region': region,
        },
        body: payload,
      })
      const result = await response.json()
      const tencentResponse = result?.Response
      if (!response.ok || tencentResponse?.Error || typeof tencentResponse?.Audio !== 'string') {
        const code = tencentResponse?.Error?.Code || `HTTP_${response.status}`
        console.error('Tencent TTS failed', code, tencentResponse?.RequestId)
        return jsonResponse({ error: `语音服务暂时不可用 (${code})` }, 502)
      }
      return jsonResponse({
        audio: tencentResponse.Audio,
        codec: 'mp3',
        requestId: tencentResponse.RequestId,
      })
    }, (response) => response.status === 200 ? speechRequest.text.length : 0)
  } catch (error) {
    if (error instanceof BudgetExceededError) {
      return jsonResponse({ error: error.message, reason: error.reason, retryAfterSeconds: error.retryAfterSeconds }, 429)
    }
    console.error('Tencent TTS request failed', error)
    return jsonResponse({ error: '连接语音服务失败，请稍后重试' }, 502)
  }
})
