import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const isCloudConfigured = Boolean(supabaseUrl && supabaseAnonKey)

export const supabase = isCloudConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null

export async function getAccessToken() {
  if (!supabase) throw new Error('尚未配置 Supabase')

  const { data: { session: currentSession }, error } = await supabase.auth.getSession()
  if (error) throw error
  if (!currentSession) throw new Error('登录已失效，请重新登录')

  let session = currentSession
  const expiresSoon = session.expires_at !== undefined && session.expires_at * 1000 <= Date.now() + 60_000
  if (expiresSoon) {
    const refreshed = await supabase.auth.refreshSession()
    if (refreshed.error) throw refreshed.error
    if (!refreshed.data.session) throw new Error('登录已失效，请重新登录')
    session = refreshed.data.session
  }

  if (!session?.access_token) throw new Error('登录已失效，请重新登录')
  return session.access_token
}