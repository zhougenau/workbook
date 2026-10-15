import { createClient } from 'npm:@supabase/supabase-js@2'

async function hashToken(token: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

export async function resolveOwner(
  authorization: string,
  supabaseUrl: string,
  anonKey: string,
  serviceRoleKey: string,
) {
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : ''
  if (!token || token.length > 4096) return null

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const authClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: userData } = await authClient.auth.getUser(token)
  if (userData.user) return { ownerId: userData.user.id, admin }

  if (token.length > 256) return null
  const { data: session, error: sessionError } = await admin
    .from('mini_sessions')
    .select('user_id, expires_at')
    .eq('token_hash', await hashToken(token))
    .maybeSingle()
  if (sessionError) throw sessionError
  if (!session || Date.parse(session.expires_at) <= Date.now()) return null

  const { data: identity, error: identityError } = await admin
    .from('wechat_identities')
    .select('owner_id')
    .eq('user_id', session.user_id)
    .single()
  if (identityError) throw identityError
  return identity ? { ownerId: identity.owner_id as string, admin } : null
}