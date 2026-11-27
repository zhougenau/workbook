const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const test = require('node:test')

const mini = path.resolve(__dirname, '../mini')
function loadMini(file, wx, pageHook) {
  const context = vm.createContext({ wx, Page: pageHook, console, setTimeout, clearTimeout })
  function load(filename) {
    const module = { exports: {} }
    const execute = vm.runInContext(`(function(require,module,exports){${fs.readFileSync(filename, 'utf8')}\n})`, context, { filename })
    execute(name => load(require.resolve(path.resolve(path.dirname(filename), name))), module, module.exports)
    return module.exports
  }
  return load(path.join(mini, file))
}

test('Passport selection is independent and limited to 20; invalid code makes no request', async () => {
  let page
  loadMini('pages/index/index.js', {}, config => { page = config })
  const ctx = { data: { ...page.data, passportOpen: true }, setData(values) { Object.assign(this.data, values) } }
  for (let index = 0; index < 21; index++) page.togglePassportWord.call(ctx, { currentTarget: { dataset: { id: String(index) } } })
  assert.equal(ctx.data.passportIds.length, 20)
  assert.equal(ctx.data.aiSelectedIds.length, 0)
  ctx.data.passportStory = { key: 'old-selection' }
  page.togglePassportWord.call(ctx, { currentTarget: { dataset: { id: '1' } } })
  assert.equal(ctx.data.passportStory, null)
  assert.equal(ctx.data.passportIds.length, 19)
  await page.sendPassportList.call(ctx)
  assert.match(ctx.data.passportMessage, /WEB CODE/)
})

test('Passport sends newest additions before recently edited older words', async () => {
  let page, request
  const word = (term, added, edited) => ({ id: require('node:crypto').randomUUID(), term, meaning: term, note: '', mastery: 0, createdAt: added, updatedAt: edited })
  const jan = '2026-01-01T00:00:00.000Z', feb = '2026-02-01T00:00:00.000Z', mar = '2026-03-01T00:00:00.000Z'
  const entries = [word('old', jan, mar), word('new', feb, feb), word('excluded', mar, mar)]
  loadMini('pages/index/index.js', {
    getStorageSync: key => key === 'wordbook-mini:data:v2' ? { version: 2, entries } : { token: 'fixture', expiresAt: '2099-01-01' },
    request: options => { request = options; options.success({ statusCode: 200, data: { ok: true } }) },
  }, config => { page = config })
  const ctx = { data: { ...page.data, passportCode: '0007', passportIds: entries.slice(0, 2).map(entry => entry.id) }, setData(values) { Object.assign(this.data, values) } }
  await page.sendPassportList.call(ctx)
  assert.deepEqual(Array.from(request.data.entries, entry => entry.term), ['new', 'old'])
})

test('publish sends only selected fields under the session and clears a rejected session', async () => {
  let request, removed, statusCode = 200
  const api = loadMini('utils/api.js', {
    getStorageSync: () => ({ token: 'fixture', expiresAt: '2099-01-01' }),
    removeStorageSync: key => { removed = key },
    request: options => { request = options; options.success({ statusCode, data: { ok: true } }) },
  })
  const words = [{ id: 'id', term: 'term', meaning: '中', note: 'note', mastery: 2 }]
  await api.publishPassport(words, '0007')
  assert.equal(request.data.code, '0007')
  assert.match(request.url, /\/passport-bound$/)
  assert.equal(request.header.Authorization, 'Bearer fixture')
  assert.deepEqual(Object.keys(request.data.entries[0]).sort(), ['id', 'meaning', 'note', 'term'])
  statusCode = 401
  await assert.rejects(api.publishPassport(words, '0123456789abcdef'))
  assert.match(removed, /session/)
})

test('publish handler binds the verified owner and produces a firmware-compatible pack', async () => {
  const ts = require('typescript')
  const shared = await import('../../supabase/functions/_shared/passport-pack.ts')
  let owner, handler, row
  const filename = path.resolve(__dirname, '../../supabase/functions/passport-publish/index.ts')
  const source = ts.transpile(fs.readFileSync(filename, 'utf8'), { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 })
  vm.runInNewContext(source, { exports: {}, Response, Deno: { serve: callback => { handler = callback }, env: { get: () => 'fixture' } }, require: name => name.includes('resolve-owner') ? { resolveOwner: async () => owner } : shared })
  const invoke = entries => handler(new Request('https://example.invalid', { method: 'POST', body: JSON.stringify({ owner_id: 'untrusted', entries, code: '0123456789abcdef' }) }))
  const words = [{ id: 'id', term: 'term', meaning: '中', note: 'note' }]
  assert.equal((await invoke(words)).status, 401)
  owner = { ownerId: 'verified', admin: { from: table => { assert.equal(table, 'passport_daily_packs'); return { upsert: value => { row = value; return {} } } } } }
  assert.equal((await invoke([])).status, 400)
  assert.equal(row, undefined)
  assert.equal((await invoke(words)).status, 200)
  assert.equal(row.owner_id, 'verified')
  assert.equal(Buffer.from(row.payload, 'base64').toString('hex'), '57425031016964007465726d00e4b8ad006e6f746500')
  assert.equal(row.code_hash, await shared.passportCodeHash('0123456789abcdef'))
})

test('bound sessions separate the public pairing identifier, user PIN and device credential', async () => {
  const shared = await import('../../supabase/functions/_shared/passport-pack.ts')
  const ts = require('typescript')
  const secret = 'ad'.repeat(32)
  const hash = require('node:crypto').createHash('sha256').update(secret).digest('hex')
  let handler, owner, registered, pin, payload
  const admin = {
    from(table) { if (table === 'vocabulary_entries') {
      const query = { select() { return this }, eq(field, value) { assert.equal(field, 'user_id'); assert.equal(value, 'owner'); return this }, is(field, value) { assert.equal(field, 'deleted_at'); assert.equal(value, null); return this }, order(field, options) { assert.equal(options.ascending, field === 'id'); return this }, limit(count) { assert.equal(count, 10); return { data: [{ id: 'recent', term: 'recent', meaning: '新', note: '' }] } } }; return query
    }
    return {
      select() { return { eq: (field, value) => ({ maybeSingle: () => ({ data: field === 'device_hash' && value === hash ? registered : null }) }) } },
      insert(row) { registered = row; return {} },
      update(values) { return { eq: (_field, key) => ({ select: () => ({ maybeSingle: () => {
        if (key !== registered.device_hash) return { data: null }; pin = values.pin; return { data: {} }
      } }) }) } },
    } },
    rpc(action, args) {
      if (action === 'passport_publish_pin') {
        if (args.account !== registered.owner_id || args.digits !== pin) return { data: false }
        payload = args.pack; return { data: true }
      }
      if (args.device !== hash) return { data: null }
      const data = payload; payload = null; return { data }
    },
  }
  const source = ts.transpile(fs.readFileSync(path.resolve(__dirname, '../../supabase/functions/passport-bound/index.ts'), 'utf8'), { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 })
  vm.runInNewContext(source, { exports: {}, Response, TextEncoder, crypto: globalThis.crypto, atob, Deno: { serve: cb => { handler = cb }, env: { get: () => 'fixture' } }, require: name => name.includes('resolve-owner') ? { resolveOwner: async () => owner } : name.startsWith('npm:') ? { createClient: () => admin } : shared })
  const call = (body = {}, headers = {}) => handler(new Request('https://example.invalid', { method: 'POST', headers, body: JSON.stringify(body) }))
  const pair = { action: 'pair', device: hash, owner_id: 'untrusted' }
  assert.equal((await call(pair)).status, 401)
  owner = { ownerId: 'owner', admin }; assert.equal((await call(pair)).status, 200)
  assert.equal(registered.owner_id, 'owner')
  const device = { 'X-Passport-Device': secret }
  assert.equal((await call({}, { ...device, 'X-Passport-Start': '0007' })).status, 200)
  const publish = { code: '0007', entries: [{ id: 'id', term: 'term', meaning: '中', note: 'note' }] }
  assert.equal((await call(publish)).status, 200)
  assert.equal((await call({}, { ...device, 'X-Passport-Recent': '11' })).status, 400)
  assert.equal((await call({}, { 'X-Passport-Device': hash, 'X-Passport-Recent': '10' })).status, 403)
  const recent = await call({ owner_id: 'untrusted' }, { ...device, 'X-Passport-Recent': '10' })
  assert.equal(recent.status, 200)
  assert.match(Buffer.from(await recent.arrayBuffer()).toString(), /recent/)
  assert.equal((await call({}, { 'X-Passport-Device': '0007' })).status, 403)
  assert.equal((await call({}, { 'X-Passport-Device': hash })).status, 404)
  const taken = await call({}, device); assert.equal(taken.status, 200)
  assert.equal(Buffer.from(await taken.arrayBuffer()).toString('hex'), '57425031016964007465726d00e4b8ad006e6f746500')
  assert.equal((await call({}, device)).status, 404)
})

test('story payload contains English, translation and target words after the entries', async () => {
  const { encodePassportPack } = await import('../../supabase/functions/_shared/passport-pack.ts')
  const words = ['oak', 'leaf', 'sun', 'rain', 'fall'].map(term => ({ id: term, term, meaning: term, note: '' }))
  const story = { passage: 'Rain fell.', translation: '下雨了。' }
  const pack = Buffer.from(encodePassportPack(words, story), 'base64')
  assert.equal(pack.subarray(0, 5).toString(), 'WBP2\x05')
  assert.deepEqual(pack.toString().split('\0').slice(-4), [story.passage, story.translation, 'oak, leaf, sun, rain, fall', ''])
  assert.throws(() => encodePassportPack(words.slice(1), story))
})