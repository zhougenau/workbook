import { getAccessToken, supabase } from './supabase'

type Counter = { used: number; limit: number }
type DailyCounter = Counter & { reserved: number }

export type PaidUsage = {
  day: string
  text: DailyCounter
  speech: DailyCounter
  requests: Counter
  speechRequests: Counter
  concurrent: Counter
}

export function notifyPaidUsageChanged() {
  window.dispatchEvent(new Event('wordbook:paid-usage-changed'))
}

export async function getPaidUsage(): Promise<PaidUsage> {
  if (!supabase) throw new Error('尚未配置 Supabase')
  const accessToken = await getAccessToken()
  const { data, error } = await supabase.functions.invoke('paid-usage', {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (error) throw new Error(error.message || '读取 AI 用量失败')
  if (!data || typeof data.day !== 'string' || !data.text || !data.speech || !data.requests || !data.speechRequests || !data.concurrent) {
    throw new Error('AI 用量数据不完整')
  }
  return data as PaidUsage
}