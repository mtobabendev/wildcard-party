import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createPennyCoreHandler } from '../lib/penny-core-handler.js'
import { emptyState } from '../lib/penny-core-state.js'

function fixture() {
  const accounts = new Map()
  const calls = []
  let failModel = false, race = false
  const handler = createPennyCoreHandler({
    currentAccount: async req => req.session ? { id: req.session } : null,
    sameOrigin: req => !req.foreign,
    readState: async id => structuredClone(accounts.get(id) || emptyState()),
    saveState: async (id, revision, next) => {
      const existing = accounts.get(id) || emptyState()
      if (race || existing.revision !== revision) return null
      const saved = { ...structuredClone(next), revision: revision + 1 }
      accounts.set(id, saved)
      return structuredClone(saved)
    },
    askModel: async (state, message) => {
      calls.push({ state: structuredClone(state), message })
      if (failModel) throw new Error('model unavailable')
      return 'Synthetic reply'
    },
    rateAllowed: () => true,
    clientIp: () => 'test',
  })
  async function request(session, method = 'GET', body, extra = {}) {
    const headers = {}
    const response = {
      code: 0, value: null,
      setHeader(k, v) { headers[k] = v },
      status(code) { this.code = code; return this },
      json(value) { this.value = value; return this },
    }
    await handler({ session, method, body, ...extra }, response)
    return { status: response.code, data: response.value, headers }
  }
  return { request, calls, accounts, fail: () => { failModel = true }, race: () => { race = true } }
}

test('authentication and origin checks precede all private state access', async () => {
  const f = fixture()
  assert.equal((await f.request(null)).status, 401)
  assert.equal((await f.request('A', 'POST', {}, { foreign: true })).status, 403)
  assert.equal((await f.request('A', 'PUT')).status, 405)
  assert.equal((await f.request('A', 'POST', '{')).status, 400)
  assert.equal(f.accounts.size, 0)
  assert.equal(f.calls.length, 0)
})

test('authenticated account owns notes and conversation; supplied account IDs cannot redirect access', async () => {
  const f = fixture()
  let result = await f.request('A', 'POST', { action: 'save-notes', revision: 0, notes: 'A synthetic note', accountId: 'B' })
  assert.equal(result.status, 200)
  assert.equal(result.data.revision, 1)
  assert.equal((await f.request('B', 'GET', undefined, { query: { accountId: 'A' } })).data.notes, '')
  result = await f.request('B', 'POST', { action: 'save-notes', revision: 0, notes: 'B synthetic note', accountId: 'A' })
  assert.equal(result.status, 200)
  result = await f.request('A', 'POST', { action: 'chat', revision: 1, message: 'A question', accountId: 'B' })
  assert.equal(result.status, 200)
  assert.equal(result.data.history.length, 2)
  assert.equal(f.calls[0].state.notes, 'A synthetic note')
  assert.equal((await f.request('B')).data.history.length, 0)
  assert.equal((await f.request('B')).data.notes, 'B synthetic note')
  assert.equal((await f.request('A')).data.notes, 'A synthetic note')
  assert.equal((await f.request('A')).headers['Cache-Control'], 'private, no-store')
})

test('stale revisions and concurrent writes are rejected; failed model does not save a turn', async () => {
  const f = fixture()
  assert.equal((await f.request('A', 'POST', { action: 'save-notes', revision: 0, notes: 'keep' })).status, 200)
  assert.equal((await f.request('A', 'POST', { action: 'chat', revision: 0, message: 'stale' })).status, 409)
  assert.equal(f.calls.length, 0)
  f.fail()
  assert.equal((await f.request('A', 'POST', { action: 'chat', revision: 1, message: 'failed' })).status, 502)
  assert.equal((await f.request('A')).data.revision, 1)
  assert.equal((await f.request('A')).data.history.length, 0)
  f.race()
  assert.equal((await f.request('A', 'POST', { action: 'save-notes', revision: 1, notes: 'race' })).status, 409)
  assert.equal((await f.request('A')).data.notes, 'keep')
})

test('clearing conversation preserves notes and does not affect another account', async () => {
  const f = fixture()
  await f.request('A', 'POST', { action: 'save-notes', revision: 0, notes: 'keep' })
  await f.request('A', 'POST', { action: 'chat', revision: 1, message: 'A' })
  await f.request('B', 'POST', { action: 'chat', revision: 0, message: 'B' })
  const result = await f.request('A', 'POST', { action: 'clear-history', revision: 2 })
  assert.equal(result.status, 200)
  assert.equal(result.data.notes, 'keep')
  assert.deepEqual(result.data.history, [])
  assert.equal((await f.request('B')).data.history.length, 2)
})
