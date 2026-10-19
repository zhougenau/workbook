import type { resolveOwner } from './resolve-owner.ts'

type Owner = NonNullable<Awaited<ReturnType<typeof resolveOwner>>>
type Resource = 'text' | 'speech'

export class BudgetExceededError extends Error {
  constructor(
    readonly reason: 'rate' | 'concurrent' | 'daily' | 'unknown' = 'unknown',
    readonly retryAfterSeconds = 0,
  ) {
    super('AI 使用过于频繁或今日额度已用完，请稍后重试')
  }
}

export async function withPaidBudget<T>(
  owner: Owner,
  resource: Resource,
  reservedUnits: number,
  operation: () => Promise<T>,
  actualUnits: (result: T) => number = () => 0,
): Promise<T> {
  if (!Number.isSafeInteger(reservedUnits) || reservedUnits < 1) throw new Error('无效的预算预留量')
  const { data, error } = await owner.admin.rpc('reserve_paid_budget', {
    p_owner_id: owner.ownerId,
    p_resource: resource,
    p_units: reservedUnits,
  })
  if (error) throw new Error('AI 额度服务暂不可用')
  if (!data || typeof data !== 'object') throw new Error('AI 额度服务返回异常')
  if (!data.allowed) {
    const reason = data.reason === 'rate' || data.reason === 'concurrent' || data.reason === 'daily'
      ? data.reason : 'unknown'
    throw new BudgetExceededError(reason, Number.isInteger(data.retry_after_seconds) ? data.retry_after_seconds : 0)
  }
  if (typeof data.lease_id !== 'string') throw new Error('AI 额度服务返回异常')

  let used = 0
  try {
    const result = await operation()
    used = actualUnits(result)
    return result
  } finally {
    const { error: releaseError } = await owner.admin.rpc('finish_paid_budget', {
      p_lease_id: data.lease_id,
      p_actual_units: Number.isSafeInteger(used) && used > 0 ? used : 0,
    })
    if (releaseError) console.error('Failed to release AI budget lease', releaseError)
  }
}