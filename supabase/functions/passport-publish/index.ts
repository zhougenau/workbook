import { resolveOwner } from '../_shared/resolve-owner.ts'
import { encodePassportPack, passportCodeHash } from '../_shared/passport-pack.ts'

Deno.serve(async request => {
  const reply = (status: number, error?: string) => Response.json(error ? { error } : { ok: true }, { status })
  if (request.method !== 'POST') return reply(405, '仅支持 POST')
  try {
    const owner = await resolveOwner(request.headers.get('Authorization') || '', Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    if (!owner) return reply(401, '请重新连接微信身份')
    let payload: string, code_hash: string
    try {
      const { code, entries } = await request.json()
      if (typeof code !== 'string' || !Array.isArray(entries) || entries.some(entry => !entry || ['id', 'term', 'meaning', 'note'].some(field => typeof entry[field] !== 'string'))) return reply(400, '词单格式不正确')
      code_hash = await passportCodeHash(code)
      payload = encodePassportPack(entries)
    } catch (error) { return reply(400, error instanceof SyntaxError ? '请求格式不正确' : error instanceof Error ? error.message : '词单无效') }
    const { error } = await owner.admin.from('passport_daily_packs').upsert({ owner_id: owner.ownerId, code_hash, payload }, { onConflict: 'owner_id' })
    if (error?.code === '23503') return reply(409, '请先将微信身份绑定到网页账号，再发送词单')
    if (error?.code === '23505') return reply(409, '领取码已被使用，请在设备上生成新码')
    if (error) return reply(503, '词单未发送，请稍后重试')
    return reply(200)
  } catch { return reply(503, '词单服务暂不可用') }
})