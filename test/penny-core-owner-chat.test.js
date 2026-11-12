import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createOwnerChatHandler, contextPacket } from '../lib/penny-core-owner-chat.js'

const owner = '11111111-1111-4111-8111-111111111111'
const other = '22222222-2222-4222-8222-222222222222'
const env = {
  VERCEL_ENV: 'production', PENNYCORE_OWNER_ACCOUNT_ID: owner,
  PENNYCORE_READ_TOKEN: 'synthetic-placeholder-only'.repeat(2),
  OPENAI_API_KEY: 'test-openai', PENNY_MODEL: 'test-openai-model',
  GEMINI_API_KEY: 'test-gemini', PENNY_GEMINI_MODEL: 'test-gemini-model',
  XAI_API_KEY: 'test-grok', PENNY_GROK_MODEL: 'test-grok-model',
}
const body = { provider: 'openai', question: 'What is the mission?', shareProjectContext: true }
const records = [{ kind: 'memory', key: 'wildcarddev/project', payload: { name: 'Synthetic project' }, createdAt: '2026-01-01T00:00:00Z', available: true }]

function fixture(overrides = {}, fail = false) {
  const calls = [], reads = []
  const handler = createOwnerChatHandler({
    currentAccount: async req => req.session ? { id: req.session } : null,
    sameOrigin: req => !req.foreign,
    rateAllowed: () => true, clientIp: () => 'test',
    env: { ...env, ...overrides },
    readContext: async account => { reads.push(account.id); return records },
    fetcher: async (url, options) => {
      calls.push({ url, options })
      return { ok: !fail, json: async () => url.includes('googleapis.com') ?
        { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'Synthetic answer' }] } }] } :
        { status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Synthetic answer' }] }] } }
    },
  })
  async function request(session, value = body, extra = {}) {
    const headers = {}
    const res = { code: 0, body: null,
      setHeader(k,v) { headers[k] = v },
      status(code) { this.code = code; return this },
      json(body) { this.body = body; return this },
    }
    await handler({ method: 'POST', session, body: value, headers: { origin: 'https://party.wildcarddev.com' }, ...extra }, res)
    return { status: res.code, body: res.body, headers }
  }
  return { request, calls, reads }
}

test('no context or provider access before owner identity, origin and explicit consent checks', async () => {
  const f = fixture()
  assert.equal((await f.request(null)).status, 401)
  assert.equal((await f.request(other)).status, 403)
  assert.equal((await f.request(owner, body, { foreign: true })).status, 403)
  assert.equal((await f.request(owner, body, { headers: {} })).status, 403)
  assert.equal((await f.request(owner, {...body, shareProjectContext: false})).status, 400)
  assert.equal((await f.request(owner, {...body, accountId: other})).status, 400)
  assert.equal((await f.request(owner, {...body, provider: 'unknown'})).status, 400)
  assert.equal((await f.request(owner, {...body, question: 'x'.repeat(2001)})).status, 400)
  assert.equal(f.calls.length, 0)
  assert.equal(f.reads.length, 0)
})

test('preview and disabled providers fail closed; status does not access records', async () => {
  const f = fixture({ VERCEL_ENV: 'preview' })
  assert.deepEqual((await f.request(owner, body, { method: 'GET' })).body, { providers: [] })
  assert.equal((await f.request(owner)).status, 503)
  assert.equal(f.calls.length, 0)
  assert.equal(f.reads.length, 0)
  const g = fixture({ GEMINI_API_KEY: '', XAI_API_KEY: '' })
  assert.deepEqual((await g.request(owner, body, { method: 'GET' })).body, { providers: ['openai'] })
  assert.equal((await g.request(owner, {...body, provider: 'gemini'})).status, 503)
  assert.equal(g.reads.length, 0)
  assert.equal(g.calls.length, 0)
})

test('three providers receive identical bounded context through fixed destinations', async () => {
  const f = fixture()
  const packet = contextPacket(records, body.question)
  for (const provider of ['openai', 'gemini', 'grok']) {
    const result = await f.request(owner, {...body, provider})
    assert.equal(result.status, 200)
    assert.equal(result.headers['Cache-Control'], 'private, no-store')
    assert.deepEqual(result.body, { provider, reply: 'Synthetic answer' })
  }
  assert.deepEqual(f.calls.map(c => c.url), [
    'https://api.openai.com/v1/responses',
    'https://generativelanguage.googleapis.com/v1beta/models/test-gemini-model:generateContent',
    'https://api.x.ai/v1/responses',
  ])
  for (const [i, call] of f.calls.entries()) {
    const sent = JSON.parse(call.options.body)
    assert.equal(i === 1 ? sent.contents[0].parts[0].text : sent.input.at(-1).content, packet)
    assert.equal(call.options.redirect, 'error')
    assert.ok(!call.options.body.includes(env.PENNYCORE_READ_TOKEN))
  }
  assert.deepEqual(f.reads, [owner, owner, owner])
})

test('provider failure does not fall back or return records; oversized context fails', async () => {
  const f = fixture({}, true)
  assert.equal((await f.request(owner)).status, 502)
  assert.equal(f.calls.length, 1)
  assert.throws(() => contextPacket([{ ...records[0], payload: { long: 'x'.repeat(16001) } }], 'question'))
})
