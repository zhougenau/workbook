const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const path = require('node:path')
const ts = require('typescript')

const source = fs.readFileSync(path.join(__dirname, '../functions/_shared/paid-budget.ts'), 'utf8')
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
const moduleExports = {}
vm.runInNewContext(code, { exports: moduleExports, console })
const { withPaidBudget, BudgetExceededError } = moduleExports

test('reserves before calling the provider and records usage on release', async () => {
  const calls = []
  const owner = { ownerId: 'owner', admin: { rpc: async (name, params) => {
    calls.push([name, params])
    return { data: name === 'reserve_paid_budget' ? { allowed: true, lease_id: 'lease' } : null }
  } } }
  const result = await withPaidBudget(owner, 'text', 500, async () => {
    assert.equal(calls.length, 1)
    return { tokens: 42 }
  }, (value) => value.tokens)
  assert.equal(result.tokens, 42)
  assert.deepEqual(calls.map(([name]) => name), ['reserve_paid_budget', 'finish_paid_budget'])
  assert.equal(calls[0][1].p_units, 500)
  assert.equal(calls[1][1].p_actual_units, 42)
})

test('denial and database errors never reach the paid provider', async () => {
  let providerCalls = 0
  const owner = { ownerId: 'owner', admin: { rpc: async () => ({ data: { allowed: false } }) } }
  await assert.rejects(withPaidBudget(owner, 'text', 500, async () => { providerCalls++ }), BudgetExceededError)
  owner.admin.rpc = async () => ({ error: new Error('offline') })
  await assert.rejects(withPaidBudget(owner, 'text', 500, async () => { providerCalls++ }), /额度服务暂不可用/)
  assert.equal(providerCalls, 0)
})

test('budget denial preserves temporary and daily reasons', async () => {
  const owner = { ownerId: 'owner', admin: { rpc: async () => ({ data: { allowed: false, reason: 'rate', retry_after_seconds: 60 } }) } }
  await assert.rejects(withPaidBudget(owner, 'speech', 200, async () => {}), (error) => {
    assert.equal(error.reason, 'rate')
    assert.equal(error.retryAfterSeconds, 60)
    return true
  })
  owner.admin.rpc = async () => ({ data: { allowed: false, reason: 'daily' } })
  await assert.rejects(withPaidBudget(owner, 'speech', 200, async () => {}), (error) => {
    assert.equal(error.reason, 'daily')
    return true
  })
})

test('provider failure still releases its lease', async () => {
  const calls = []
  const owner = { ownerId: 'owner', admin: { rpc: async (name) => {
    calls.push(name)
    return { data: { allowed: true, lease_id: 'lease' } }
  } } }
  await assert.rejects(withPaidBudget(owner, 'speech', 100, async () => { throw new Error('provider offline') }), /provider offline/)
  assert.deepEqual(calls, ['reserve_paid_budget', 'finish_paid_budget'])
})

test('word completion responds with 429 on exhausted budget', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../functions/complete-word/index.ts'), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
  let handler
  vm.runInNewContext(code, {
    exports: {},
    require: (name) => name.includes('ai-provider')
      ? { parseAiProvider: () => 'deepseek', hasAiProviderKey: () => true, callAiProvider: async () => { throw new BudgetExceededError() } }
      : name.includes('paid-budget') ? { BudgetExceededError } : { resolveOwner: async () => ({ ownerId: 'owner' }) },
    Deno: { serve: (callback) => { handler = callback }, env: { get: () => 'configured' } },
    Response,
  })
  const request = new Request('https://example.test/complete-word', {
    method: 'POST',
    headers: { Authorization: 'Bearer test' },
    body: JSON.stringify({ term: 'example' }),
  })
  const response = await handler(request)
  assert.equal(response.status, 429)
  assert.match((await response.json()).error, /额度/)
})

test('usage endpoint requires login and reads only the authenticated owner', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../functions/paid-usage/index.ts'), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
  const filters = []
  let authenticated = true
  let handler
  const owner = { ownerId: 'current-owner', admin: { from: (table) => {
    let resource = 'text'
    const result = () => table === 'paid_budget_days'
      ? { data: { actual_text_tokens: 42, reserved_text_tokens: 400, actual_speech_chars: 0, reserved_speech_chars: 0 }, error: null }
      : { count: table === 'paid_budget_requests' ? resource === 'text' ? 3 : 2 : 1, error: null }
    return {
      select() { return this },
      eq(field, value) { filters.push([table, field, value]); if (field === 'resource') resource = value; return this },
      gt() { return this },
      maybeSingle: async () => result(),
      then: (resolve, reject) => Promise.resolve(result()).then(resolve, reject),
    }
  } } }
  vm.runInNewContext(code, {
    exports: {},
    require: () => ({ resolveOwner: async () => authenticated ? owner : null }),
    Deno: { serve: (callback) => { handler = callback }, env: { get: () => 'configured' } },
    Response, Date, Number, Promise, console,
  })
  const url = 'https://example.test/paid-usage'
  assert.equal((await handler(new Request(url))).status, 401)
  assert.equal(filters.length, 0)
  const response = await handler(new Request(url, { headers: { Authorization: 'Bearer test' } }))
  assert.equal(response.status, 200)
  const usage = await response.json()
  assert.deepEqual(usage.text, { used: 42, reserved: 400, limit: 1000000 })
  assert.deepEqual(usage.requests, { used: 3, limit: 10 })
  assert.deepEqual(usage.speechRequests, { used: 2, limit: 60 })
  assert.deepEqual(usage.speech, { used: 0, reserved: 0, limit: 30000 })
  assert.deepEqual(usage.concurrent, { used: 1, limit: 2 })
  assert.equal(filters.filter(([, field, value]) => field === 'owner_id' && value === 'current-owner').length, 4)
  assert.deepEqual(filters.filter(([, field]) => field === 'resource').map(([, , value]) => value), ['text', 'speech'])
  assert.equal(JSON.stringify(usage).includes('current-owner'), false)
  authenticated = false
  assert.equal((await handler(new Request(url, { headers: { Authorization: 'Bearer expired' } }))).status, 401)
})

test('usage endpoint reports empty days and fails closed on query errors', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../functions/paid-usage/index.ts'), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
  let handler
  let failed = false
  const owner = { ownerId: 'owner', admin: { from: () => {
    const result = () => ({ data: null, count: 0, error: failed ? new Error('private database detail') : null })
    return {
      select() { return this }, eq() { return this }, gt() { return this },
      maybeSingle: async () => result(),
      then: (resolve, reject) => Promise.resolve(result()).then(resolve, reject),
    }
  } } }
  vm.runInNewContext(code, {
    exports: {}, require: () => ({ resolveOwner: async () => owner }),
    Deno: { serve: (callback) => { handler = callback }, env: { get: () => 'configured' } },
    Response, Date, Number, Promise, console,
  })
  const request = () => new Request('https://example.test/paid-usage', { headers: { Authorization: 'Bearer test' } })
  const empty = await handler(request())
  assert.equal(empty.status, 200)
  assert.deepEqual((await empty.json()).speech, { used: 0, reserved: 0, limit: 30000 })
  failed = true
  const error = await handler(request())
  assert.equal(error.status, 500)
  assert.equal(JSON.stringify(await error.json()).includes('private database detail'), false)
})

test('Mini usage read sends its session and removes it after a 401', async () => {
  let session = { token: 'mini-secret', expiresAt: new Date(Date.now() + 60_000).toISOString() }
  let statusCode = 200
  let sentAuthorization
  const wx = {
    getStorageSync: () => session,
    removeStorageSync: () => { session = null },
    request: ({ header, success }) => {
      sentAuthorization = header.Authorization
      success({ statusCode, data: statusCode === 200
        ? { day: '2026-01-01', text: {}, speech: {}, requests: {}, speechRequests: {}, concurrent: {} }
        : { error: '登录已失效' } })
    },
  }
  const mini = { exports: {} }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../apps/mini/utils/api.js'), 'utf8'), {
    module: mini, require: () => ({}), wx, Promise, Date, Error,
  })
  const { getPaidUsage } = mini.exports
  assert.equal((await getPaidUsage()).day, '2026-01-01')
  assert.equal(sentAuthorization, 'Bearer mini-secret')
  statusCode = 401
  await assert.rejects(getPaidUsage(), /登录已失效/)
  assert.equal(session, null)
  await assert.rejects(getPaidUsage(), /请先连接微信身份/)
})

test('Mini card speech prefetch retries 429 and stops after cancellation', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../../apps/mini/pages/index/index.js'), 'utf8')
  let page
  const timers = []
  vm.runInNewContext(source, {
    Page: (options) => { page = options },
    require: (name) => name.includes('wordbook-core')
      ? { DEFAULT_PAGE_SIZE: 10, PAGE_SIZE_OPTIONS: [10], AI_PROVIDERS: [], DEFAULT_AI_PROVIDER: 'deepseek', MASTERY_FILTER_OPTIONS: [], VOCABULARY_SORT_OPTIONS: [], WORD_CHAT_SUGGESTIONS: [], MAX_WORD_CHAT_MESSAGE_LENGTH: 500 }
      : {},
    setTimeout: (callback, delay) => { timers.push({ callback, delay }); return timers.length },
  })
  page.speechPrefetchGeneration = 0
  let calls = 0
  page.getSpeechAudio = async () => {
    calls++
    if (calls === 1) throw Object.assign(new Error('rate limited'), { statusCode: 429, reason: 'rate' })
    return 'audio'
  }
  page.prefetchFlashcardSpeech([{ word: 'one', usage: 'example' }])
  await new Promise(setImmediate)
  assert.equal(calls, 1)
  assert.equal(timers.length, 1)
  assert.equal(timers[0].delay, 60_000)
  timers.shift().callback()
  await new Promise(setImmediate)
  assert.equal(calls, 2)

  calls = 0
  page.prefetchFlashcardSpeech([{ word: 'two', usage: 'example' }])
  await new Promise(setImmediate)
  page.cancelSpeechPrefetch()
  timers.shift().callback()
  await new Promise(setImmediate)
  assert.equal(calls, 1)

  page.getSpeechAudio = async () => { throw Object.assign(new Error('busy'), { statusCode: 429, reason: 'concurrent' }) }
  page.prefetchFlashcardSpeech([{ word: 'three', usage: 'example' }])
  await new Promise(setImmediate)
  assert.equal(timers.shift().delay, 2_000)
  page.cancelSpeechPrefetch()

  page.getSpeechAudio = async () => { throw Object.assign(new Error('spent'), { statusCode: 429, reason: 'daily' }) }
  page.prefetchFlashcardSpeech([{ word: 'four', usage: 'example' }])
  await new Promise(setImmediate)
  assert.equal(timers.length, 0)
})

test('review sync rejects foreign words and scopes writes to the authenticated owner', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../functions/review-sync/index.ts'), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
  let handler
  let owned = false
  const calls = []
  const wordId = '00000000-0000-4000-8000-000000000001'
  const admin = { from(table) {
    assert.equal(table, 'vocabulary_entries')
    return { select() { return this }, in: async () => ({ data: [{ id: wordId, user_id: owned ? 'owner' : 'other', deleted_at: null }] }) }
  }, rpc: async (name, args) => { calls.push([name, args]); return { error: null } } }
  admin.from = (table) => table === 'review_schedules'
    ? { select() { return this }, eq: async (field, value) => {
      assert.equal(field, 'owner_id')
      assert.equal(value, 'owner')
      return { data: [], error: null }
    } }
    : { select() { return this }, in: async () => ({ data: [{ id: wordId, user_id: owned ? 'owner' : 'other', deleted_at: null }], error: null }) }
  vm.runInNewContext(code, {
    exports: {},
    require: () => ({ resolveOwner: async (authorization) => authorization ? { ownerId: 'owner', admin } : null }),
    Deno: { serve: (callback) => { handler = callback }, env: { get: () => 'configured' } },
    Response, console, Date, Number, Map, Set,
  })
  const url = 'https://example.test/review-sync'
  assert.equal((await handler(new Request(url, { method: 'POST', body: '{}' }))).status, 401)
  const schedule = { wordId, dueAt: '2026-10-24T09:00:00.000Z', intervalDays: 1, streak: 1, lastReviewedAt: '2026-10-23T09:00:00.000Z', updatedAt: '2026-10-23T09:00:00.000Z' }
  const send = () => handler(new Request(url, { method: 'POST', headers: { Authorization: 'Bearer test' }, body: JSON.stringify({ schedules: [schedule] }) }))
  assert.equal((await send()).status, 403)
  assert.equal(calls.length, 0)
  owned = true
  assert.equal((await send()).status, 200)
  assert.equal(calls.length, 1)
  assert.equal(calls[0][0], 'merge_review_schedules')
  assert.equal(calls[0][1].p_owner_id, 'owner')
})

test('Mini vocabulary writes preserve independent daily review schedules', () => {
  const storage = new Map()
  const wx = {
    getStorageSync: (key) => storage.get(key),
    setStorageSync: (key, value) => storage.set(key, value),
    removeStorageSync: (key) => storage.delete(key),
  }
  const mini = { exports: {} }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../apps/mini/utils/storage.js'), 'utf8'), {
    module: mini, require: () => ({ normalizeVocabularyEntry: (value) => value }), wx, Date, console, Math,
  })
  const { initializeStorage, saveEntries, loadReviewSchedules, saveReviewSchedules } = mini.exports
  initializeStorage()
  saveReviewSchedules([{ wordId: 'word', dueAt: '2026-10-24T09:00:00.000Z' }])
  saveEntries([{ id: 'word', term: 'test' }])
  assert.equal(loadReviewSchedules()[0].wordId, 'word')
  assert.equal(mini.exports.loadEntries()[0].id, 'word')
})