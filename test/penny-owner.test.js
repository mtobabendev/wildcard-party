import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createOwnerHandler, isOwner } from '../lib/penny-owner.js'

const owner = '11111111-1111-4111-8111-111111111111'
const other = '22222222-2222-4222-8222-222222222222'
const env = { VERCEL_ENV: 'production', PENNYCORE_OWNER_ACCOUNT_ID: owner, PENNYCORE_READ_TOKEN: 'synthetic-test-placeholder-only'.repeat(2) }

function fixture(overrides = {}, badResponse = false) {
  const calls = []
  const handler = createOwnerHandler({
    currentAccount: async req => req.session ? { id: req.session, handle: 'owner' } : null,
    sameOrigin: req => !req.foreign,
    env: { ...env, ...overrides },
    fetcher: async (raw, options) => {
      const url = new URL(raw)
      calls.push({ url, options })
      return { ok: true, json: async () => ({ records: [{
        kind: url.searchParams.get('kind'), key: badResponse ? 'unexpected' : url.searchParams.get('key'),
        payload: { synthetic: true }, createdAt: '2026-01-01T00:00:00Z', requestId: 'not forwarded',
      }] }) }
    },
  })
  async function request(session, query = { view: 'records' }, extra = {}) {
    const headers = {}
    const res = { code: 0, body: null,
      setHeader(k,v) { headers[k] = v },
      status(code) { this.code = code; return this },
      json(body) { this.body = body; return this },
    }
    await handler({ method: 'GET', session, query, ...extra }, res)
    return { status: res.code, body: res.body, headers }
  }
  return { request, calls }
}

test('owner identity is immutable account UUID, not handle or supplied request identity', async () => {
  assert.equal(isOwner({ id: other, handle: 'owner' }, env), false)
  assert.equal(isOwner({ id: owner }, {}), false)
  assert.equal(isOwner({ id: 'not-a-uuid' }, { PENNYCORE_OWNER_ACCOUNT_ID: 'not-a-uuid' }), false)
  const f = fixture()
  assert.equal((await f.request(null)).status, 401)
  assert.equal((await f.request(other, { view: 'records', accountId: owner })).status, 403)
  assert.equal((await f.request(other, { view: 'status' })).status, 403)
  assert.equal((await f.request(owner, { view: 'records' }, { foreign: true })).status, 403)
  assert.equal((await f.request(owner, { view: 'records' }, { method: 'POST' })).status, 405)
  assert.equal(f.calls.length, 0)
})

test('missing config and preview fail closed without production network access', async () => {
  for (const overrides of [{ VERCEL_ENV: 'preview' }, { PENNYCORE_READ_TOKEN: '' }]) {
    const f = fixture(overrides)
    assert.deepEqual((await f.request(owner, { view: 'status' })).body, { owner: true, ready: false })
    assert.equal((await f.request(owner)).status, 503)
    assert.equal(f.calls.length, 0)
  }
  const f = fixture({ PENNYCORE_OWNER_ACCOUNT_ID: '' })
  assert.equal((await f.request(owner)).status, 403)
  assert.equal(f.calls.length, 0)
})

test('only six fixed latest records, read-only, no token or internal request ID in response', async () => {
  const f = fixture()
  assert.equal((await f.request(owner, { view: 'records', key: 'arbitrary' })).status, 400)
  assert.equal(f.calls.length, 0)
  const status = await f.request(owner, { view: 'status' })
  assert.deepEqual(status.body, { owner: true, ready: true })
  assert.equal(f.calls.length, 0)
  const result = await f.request(owner)
  assert.equal(result.status, 200)
  assert.equal(result.headers['Cache-Control'], 'private, no-store')
  assert.equal(result.body.records.length, 6)
  assert.equal(f.calls.length, 6)
  assert.deepEqual(f.calls.map(c => c.url.searchParams.get('kind') + '/' + c.url.searchParams.get('key')), [
    'memory/wildcarddev/project', 'governance/engineering/occam', 'governance/engineering/owner-gate',
    'governance/pennycore/data-boundaries', 'context/pennycore/architecture', 'state/pennycore/rollout',
  ])
  for (const {url, options} of f.calls) {
    assert.equal(url.origin + url.pathname, 'https://www.wildcarddev.com/api/pennycore')
    assert.equal(url.searchParams.get('latest'), '1')
    assert.equal(options.method, 'GET')
    assert.equal(options.redirect, 'error')
  }
  assert.ok(!JSON.stringify(result.body).includes(env.PENNYCORE_READ_TOKEN))
  assert.ok(!JSON.stringify(result.body).includes('requestId'))
})

test('unexpected upstream record fails closed', async () => {
  const f = fixture({}, true)
  assert.equal((await f.request(owner)).status, 503)
})
