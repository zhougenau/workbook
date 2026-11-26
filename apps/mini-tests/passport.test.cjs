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
  page.togglePassportWord.call(ctx, { currentTarget: { dataset: { id: '1' } } })
  assert.equal(ctx.data.passportIds.length, 19)
  await page.sendPassportList.call(ctx)
  assert.match(ctx.data.passportMessage, /WEB CODE/)
})

test('publish sends only selected fields under the session and clears a rejected session', async () => {
  let request, removed, statusCode = 200
  const api = loadMini('utils/api.js', {
    getStorageSync: () => ({ token: 'fixture', expiresAt: '2099-01-01' }),
    removeStorageSync: key => { removed = key },
    request: options => { request = options; options.success({ statusCode, data: { ok: true } }) },
  })
  const words = [{ id: 'id', term: 'term', meaning: '中', note: 'note', mastery: 2 }]
  await api.publishPassport(words, '0123456789abcdef')
  assert.match(request.url, /\/passport-publish$/)
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