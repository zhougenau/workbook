const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const path = require('node:path')
const ts = require('typescript')

const source = fs.readFileSync(path.join(__dirname, '../functions/generate-review/index.ts'), 'utf8')
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
const word = { id: 'word-1', term: 'postpone', meaning: '推迟', note: '' }

function createHandler(questions) {
  let handler
  const prompts = []
  const owner = { ownerId: 'owner', admin: { from: () => ({
    select() { return this },
    eq() { return this },
    is() { return this },
    in: async () => ({ data: [word], error: null }),
  }) } }
  vm.runInNewContext(code, {
    exports: {},
    require: (name) => name.includes('ai-provider')
      ? {
        parseAiProvider: () => 'deepseek', hasAiProviderKey: () => true,
        callAiProvider: async (_owner, _provider, messages) => {
          prompts.push(messages[0].content)
          return { content: JSON.stringify({ title: '复习', questions }), tokenUsage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } }
        },
      }
      : name.includes('paid-budget') ? { BudgetExceededError: class extends Error {} } : { resolveOwner: async () => owner },
    Deno: { serve: (callback) => { handler = callback }, env: { get: () => 'configured' } },
    Response, console,
  })
  return { handler, prompts }
}

function question(type, index) {
  return {
    id: `q${index}`, type, wordId: word.id, word: word.term,
    prompt: 'The meeting was ____ until Friday.',
    options: ['postpone', 'delay', 'cancel', 'reschedule'],
    correctIndex: 0, explanation: '此处表示延期；cancel 表示取消，不适合。',
  }
}

async function requestReview(handler, mode) {
  const body = { wordIds: [word.id], questionCount: 5, difficulty: 'basic', provider: 'deepseek' }
  if (mode !== undefined) body.mode = mode
  return handler(new Request('https://example.test/generate-review', {
    method: 'POST', headers: { Authorization: 'Bearer test' }, body: JSON.stringify(body),
  }))
}

test('context mode accepts both contextual question types', async () => {
  const { handler, prompts } = createHandler(['scenario', 'collocation', 'scenario', 'collocation', 'scenario'].map(question))
  const response = await requestReview(handler, 'context')
  assert.equal(response.status, 200)
  assert.equal((await response.json()).questions.length, 5)
  assert.match(prompts[0], /不出翻译选择题/)
})

test('context mode rejects meaning questions and missing collocation questions', async () => {
  for (const types of [
    ['scenario', 'collocation', 'meaning', 'scenario', 'collocation'],
    ['scenario', 'scenario', 'scenario', 'scenario', 'scenario'],
  ]) {
    const { handler } = createHandler(types.map(question))
    const response = await requestReview(handler, 'context')
    assert.equal(response.status, 502)
  }
})

test('context mode rejects feedback without a concrete distractor comparison', async () => {
  const questions = ['scenario', 'collocation', 'scenario', 'collocation', 'scenario'].map(question)
  questions[0].explanation = '这个词表示推迟。'
  const { handler } = createHandler(questions)
  assert.equal((await requestReview(handler, 'context')).status, 502)
})

test('existing clients default to standard questions and unknown modes are rejected', async () => {
  const { handler } = createHandler(Array.from({ length: 5 }, (_, index) => question('meaning', index)))
  assert.equal((await requestReview(handler)).status, 200)
  assert.equal((await requestReview(handler, 'contextual')).status, 422)
})