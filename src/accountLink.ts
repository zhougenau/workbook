import { getAccessToken, supabase } from './supabase'

export type AccountLinkCode = {
  code: string
  expiresAt: string
}

async function getFunctionErrorMessage(error: { message: string; context?: unknown }) {
  if (error.context instanceof Response) {
    try {
      const body = await error.context.clone().json() as { error?: unknown }
      if (typeof body.error === 'string' && body.error.trim()) return body.error
    } catch {
      // Fall back to the Supabase client message when the response is not JSON.
    }
  }
  return error.message || '创建微信绑定码失败'
}

export async function createAccountLinkCode() {
  if (!supabase) throw new Error('尚未配置 Supabase')
  const accessToken = await getAccessToken()
  const { data, error } = await supabase.functions.invoke('create-link-code', {
    body: {},
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (error) throw new Error(await getFunctionErrorMessage(error))
  if (!data || typeof data.code !== 'string' || typeof data.expiresAt !== 'string') {
    throw new Error('绑定服务返回了无法识别的数据')
  }
  return data as AccountLinkCode
}
