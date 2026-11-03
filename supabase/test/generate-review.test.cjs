const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const path = require('node:path')
const ts = require('typescript')

const source = fs.readFileSync(path.join(__dirname, '../functions/generate-review/index.ts'), 'utf8')
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
const word = { id: 'word-1', term: 'postpone', meaning: '推迟', note: '' }

function createHandler(questions, words = [word], random = Math.random) {
  let handler
  const prompts = []
  const owner = { ownerId: 'owner', admin: { from: () => ({
    select() { return this },
    eq() { return this },
    is() { return this },
    in: async () => ({ data: words, error: null }),
  }) } }
  vm.runInNewContext(code, {
    exports: {},
    require: (name) => name.includes('ai-provider')
      ? {
        parseAiProvider: () => 'deepseek', hasAiProviderKey: () => true,
        callAiProvider: async (_owner, _provider, messages) => {
          prompts.push(messages)
          return { content: JSON.stringify({ title: '复习', questions }), tokenUsage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } }
        },
      }
      : name.includes('paid-budget') ? { BudgetExceededError: class extends Error {} } : { resolveOwner: async () => owner },
    Deno: { serve: (callback) => { handler = callback }, env: { get: () => 'configured' } },
    Response, console, Math: Object.assign(Object.create(Math), { random }),
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

async function requestReview(handler, mode, wordIds = [word.id], questionCount = 5) {
  const body = { wordIds, questionCount, difficulty: 'basic', provider: 'deepseek' }
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
  assert.match(prompts[0][0].content, /不出翻译选择题/)
})

test('multi-word context request assigns each question a word and alternating type', async () => {
  const other = { id: 'word-2', term: 'defer', meaning: '推迟', note: '' }
  const questions = ['scenario', 'collocation', 'scenario', 'collocation', 'scenario'].map(question)
  questions[1].wordId = other.id
  questions[1].word = other.term
  const { handler, prompts } = createHandler(questions, [word, other])
  assert.equal((await requestReview(handler, 'context', [word.id, other.id])).status, 200)
  assert.match(prompts[0][1].content, /q1.*scenario.*word-1.*postpone/)
  assert.match(prompts[0][1].content, /q2.*collocation.*word-2.*defer/)
  assert.match(prompts[0][1].content, /q5.*scenario.*word-1.*postpone/)
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

test('context mode rejects empty feedback', async () => {
  const questions = ['scenario', 'collocation', 'scenario', 'collocation', 'scenario'].map(question)
  questions[0].explanation = ''
  const { handler } = createHandler(questions)
  assert.equal((await requestReview(handler, 'context')).status, 502)
})

test('context mode accepts a Chinese comparison without literal English distractor text', async () => {
  const questions = ['scenario', 'collocation', 'scenario', 'collocation', 'scenario'].map(question)
  questions[0].explanation = '这里要改动会议日期；取消意味着会议不会再举行。'
  const { handler } = createHandler(questions)
  assert.equal((await requestReview(handler, 'context')).status, 200)
})

test('invalid context output is not automatically billed twice', async () => {
  const { handler, prompts } = createHandler(Array.from({ length: 5 }, (_, index) => question('meaning', index)))
  const response = await requestReview(handler, 'context')
  assert.equal(response.status, 502)
  assert.equal(prompts.length, 1)
  assert.equal((await response.json()).tokenUsage.totalTokens, 2)
})

test('existing clients default to standard questions and unknown modes are rejected', async () => {
  const { handler } = createHandler(Array.from({ length: 5 }, (_, index) => question('meaning', index)))
  assert.equal((await requestReview(handler)).status, 200)
  assert.equal((await requestReview(handler, 'contextual')).status, 422)
})

test('answer positions are balanced while correct content and feedback are preserved', async () => {
  for (const mode of ['standard', 'context']) {
    for (const count of [5, 8, 60]) {
      const questions = Array.from({ length: count }, (_, index) => question(mode === 'standard' ? 'meaning' : index % 2 ? 'collocation' : 'scenario', index))
      questions.forEach((item, index) => { item.correctIndex = index % 4 })
      const original = JSON.parse(JSON.stringify(questions))
      const { handler, prompts } = createHandler(questions)
      const response = await requestReview(handler, mode, [word.id], count)
      assert.equal(response.status, 200)
      const result = await response.json()
      const counts = [0, 0, 0, 0]
      result.questions.forEach((item, index) => {
        counts[item.correctIndex] += 1
        assert.equal(item.options[item.correctIndex], original[index].options[original[index].correctIndex])
        assert.deepEqual([...item.options].sort(), [...original[index].options].sort())
        assert.deepEqual({ ...item, options: original[index].options, correctIndex: original[index].correctIndex }, original[index])
      })
      assert.ok(Math.max(...counts) - Math.min(...counts) <= 1)
      assert.ok(counts.every(value => value > 0))
      assert.deepEqual(questions, original)
      assert.equal(prompts.length, 1)
      assert.equal(result.tokenUsage.totalTokens, 2)
    }
  }
})

test('model answers all at A are redistributed and the order varies with randomness', async () => {
  const questions = Array.from({ length: 8 }, (_, index) => question('meaning', index))
  const orders = []
  for (const random of [() => 0, () => 0.99]) {
    const { handler } = createHandler(questions, [word], random)
    const response = await requestReview(handler, 'standard', [word.id], questions.length)
    const result = await response.json()
    const counts = [0, 0, 0, 0]
    result.questions.forEach(item => {
      counts[item.correctIndex] += 1
      assert.equal(item.options[item.correctIndex], 'postpone')
    })
    assert.deepEqual(counts, [2, 2, 2, 2])
    orders.push(result.questions.map(item => item.correctIndex))
  }
  assert.notDeepEqual(orders[0], orders[1])
})