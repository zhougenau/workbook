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