import { createClient } from 'npm:@supabase/supabase-js@2'
import { resolveOwner } from '../_shared/resolve-owner.ts'
import { encodePassportPack } from '../_shared/passport-pack.ts'

const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Cache-Control': 'no-store' }
const reply = (status: number, error?: string) => Response.json(error ? { error } : { ok: true }, { status, headers })
Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response(null, { headers })
  if (request.method !== 'POST') return reply(405, '仅支持 POST')
  const url = Deno.env.get('SUPABASE_URL')!, service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  try {
    const secret = request.headers.get('X-Passport-Device')
    if (secret !== null) {
      if (!/^[0-9a-f]{64}$/.test(secret)) return reply(403, '未绑定')
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret))), byte => byte.toString(16).padStart(2, '0')).join('')
      const admin = createClient(url, service, { auth: { persistSession: false } })
      const recent = request.headers.get('X-Passport-Recent')
      if (recent !== null) {
        if (recent !== '10' && recent !== '20') return reply(400, '数量无效')
        const binding = await admin.from('passport_devices').select('owner_id').eq('device_hash', hash).maybeSingle()
        if (binding.error) return reply(503, '服务不可用')
        if (!binding.data) return reply(403, '请先扫码绑定')
        const words = await admin.from('vocabulary_entries').select('id,term,meaning,note').eq('user_id', binding.data.owner_id).is('deleted_at', null).order('created_at', { ascending: false }).order('id', { ascending: true }).limit(Number(recent))
        if (words.error) return reply(503, '读取失败')
        if (!words.data?.length) return reply(404, '暂无词条')
        try {
          const pack = encodePassportPack(words.data)
          return new Response(Uint8Array.from(atob(pack), char => char.charCodeAt(0)), { headers: { ...headers, 'Content-Type': 'application/octet-stream' } })
        } catch { return reply(422, '最近词单超过设备限制') }
      }
      const pin = request.headers.get('X-Passport-Start')
      if (pin !== null) {
        if (!/^\d{4}$/.test(pin)) return reply(400, '无效码')
        const { data, error } = await admin.from('passport_devices').update({ pin, attempts: 0, payload: null, expires_at: new Date(Date.now() + 120000).toISOString() }).eq('device_hash', hash).select('device_hash').maybeSingle()
        if (error) return reply(503, '服务不可用')
        return data ? reply(200) : reply(403, '请扫码绑定')
      }
      const { data, error } = await admin.rpc('passport_take_bound', { device: hash })
      if (error) return reply(503, '服务不可用')
      if (!data) return reply(404, '暂无词单')
      return new Response(Uint8Array.from(atob(data), char => char.charCodeAt(0)), { headers: { ...headers, 'Content-Type': 'application/octet-stream' } })
    }
    const owner = await resolveOwner(request.headers.get('Authorization') || '', url, Deno.env.get('SUPABASE_ANON_KEY')!, service)
    if (!owner) return reply(401, '请重新登录')
    const body = await request.json().catch(() => null)
    if (body?.action === 'pair' && typeof body.device === 'string' && /^[0-9a-f]{64}$/.test(body.device)) {
      const { error } = await owner.admin.from('passport_devices').insert({ owner_id: owner.ownerId, device_hash: body.device })
      if (error?.code === '23505') {
        const { data } = await owner.admin.from('passport_devices').select('device_hash').eq('owner_id', owner.ownerId).eq('device_hash', body.device).maybeSingle()
        return data ? reply(200) : reply(409, '账号或设备已绑定，不能覆盖')
      }
      if (error?.code === '23503') return reply(409, '请先绑定词屿网页账号')
      return error ? reply(503, '绑定失败') : reply(200)
    }
    if (typeof body?.code !== 'string' || !/^\d{4}$/.test(body.code) || !Array.isArray(body.entries) || !body.entries.length || body.entries.length > 20) return reply(400, '请选择词条并输入 4 位数字')
    let pack: string
    try { pack = encodePassportPack(body.entries, body.story) } catch { return reply(400, '词条或短文不符合 Passport 格式') }
    const { data, error } = await owner.admin.rpc('passport_publish_pin', { account: owner.ownerId, digits: body.code, pack })
    if (error) return reply(503, '发送失败')
    return data ? reply(200) : reply(409, '请确认已绑定，或在设备上重新生成 4 位码')
  } catch { return reply(503, '服务暂不可用') }
})