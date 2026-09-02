export type SyncStage = '验证登录状态' | '读取本地词条' | '下载云端词条' | '上传本地词条' | '保存同步结果'

type ErrorDetails = {
  message?: unknown
  code?: unknown
  details?: unknown
  hint?: unknown
  status?: unknown
  name?: unknown
}

function cleanDetail(value: unknown) {
  if (value === undefined || value === null || value === '') return ''
  return String(value)
    .replace(/Bearer\s+\S+/gi, 'Bearer [已隐藏]')
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[JWT 已隐藏]')
    .trim()
    .slice(0, 600)
}

function getDetails(error: unknown): ErrorDetails {
  if (error instanceof Error) {
    return { ...error as Error & ErrorDetails, message: error.message, name: error.name }
  }
  return error && typeof error === 'object' ? error as ErrorDetails : { message: error }
}

function troubleshooting(stage: SyncStage, details: ErrorDetails) {
  const code = cleanDetail(details.code).toUpperCase()
  const status = cleanDetail(details.status)
  const message = cleanDetail(details.message).toLowerCase()

  if (status === '401' || code.includes('JWT') || /jwt|token|session|登录/.test(message)) {
    return '退出后重新登录，再点击“立即同步”；若仍失败，检查 Supabase Auth 会话和项目 URL/Publishable Key 是否匹配。'
  }
  if (code === '42501' || /row-level security|permission denied|rls/.test(message)) {
    return '检查 vocabulary_entries 的 RLS 策略，以及记录 user_id 是否等于当前 auth.uid()；跨账号导入不能沿用原账号所有者。'
  }
  if (code === '23505' || /duplicate key|unique constraint/.test(message)) {
    return '检查云端唯一约束和重复单词；确认导入去重使用 normalized_term，并检查冲突记录是否属于当前账号。'
  }
  if (['23514', '22007', '22P02'].includes(code) || /invalid input|check constraint/.test(message)) {
    return '检查导入文件字段：单词不能为空且不超过 200 字符，掌握程度须为 0–5，时间须为有效 ISO 日期。'
  }
  if (code === '23503' || /foreign key/.test(message)) {
    return '确认当前登录用户仍存在于 Supabase Auth，并检查 vocabulary_entries.user_id 外键。'
  }
  if (code === 'PGRST204' || code === '42703' || /column .* does not exist|schema cache/.test(message)) {
    return '线上表结构可能未更新；在 Supabase SQL Editor 重新核对 supabase/schema.sql，并刷新 PostgREST schema cache。'
  }
  if (/failed to fetch|network|fetch|cors|load failed/.test(message)) {
    return '检查网络、浏览器拦截和 Supabase 服务状态；确认站点域名允许访问项目 API，然后点击“立即同步”重试。'
  }
  if (stage === '读取本地词条' || stage === '保存同步结果') {
    return '检查浏览器是否禁用了 IndexedDB、是否处于受限隐私模式，以及站点存储配额是否已满。'
  }
  if (stage === '上传本地词条') {
    return '在 Supabase Dashboard 查看 vocabulary_entries 表和 API Logs，并核对导入记录的字段、RLS 与约束。修复后点击“立即同步”。'
  }
  return '在 Supabase Dashboard 查看 API Logs，并核对项目 URL、登录会话、vocabulary_entries 表结构和 RLS 策略。'
}

export function createSyncError(stage: SyncStage, error: unknown, affectedCount?: number) {
  const details = getDetails(error)
  const message = cleanDetail(details.message) || '未知错误'
  const lines = [`同步失败 · ${stage}`, `原因：${message}`]
  const code = cleanDetail(details.code)
  const status = cleanDetail(details.status)
  const detail = cleanDetail(details.details)
  const hint = cleanDetail(details.hint)

  if (code) lines.push(`错误码：${code}`)
  if (status) lines.push(`HTTP 状态：${status}`)
  if (detail && detail !== message) lines.push(`服务端详情：${detail}`)
  if (hint) lines.push(`服务端提示：${hint}`)
  if (affectedCount !== undefined) lines.push(`待上传词条：${affectedCount}`)
  lines.push(`调试方向：${troubleshooting(stage, details)}`)
  lines.push('本地词条不会因同步失败而丢失。')

  return new Error(lines.join('\n'), { cause: error })
}