import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizePresentation, presentationInstructions } from '../lib/penny-presentation.js'
test('standard instructions are unchanged',()=>{assert.equal(presentationInstructions('baseline'),'baseline');assert.equal(normalizePresentation(undefined),'standard')})
test('cabaret is fixed and preserves baseline and nonexplicit boundaries',()=>{const s=presentationInstructions('baseline','cabaret');assert.ok(s.startsWith('baseline\n\n'));assert.match(s,/Never become explicit/);assert.match(s,/security, accuracy, and safety/);assert.throws(()=>normalizePresentation('arbitrary prompt'));assert.throws(()=>normalizePresentation({}));assert.throws(()=>normalizePresentation(null))})

import { EventEmitter } from 'node:events'
import handler from '../api/penny.js'

test('external provider transport and response diagnostics are bounded and fail closed', async (t) => {
  const keys = ['PENNY_EXTERNAL_PROVIDERS', 'GEMINI_API_KEY', 'PENNY_GEMINI_MODEL', 'XAI_API_KEY', 'PENNY_GROK_MODEL']
  const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]))
  const fetchBefore = globalThis.fetch
  const warnBefore = console.warn
  const logs = []
  const requests = []
  const secret = 'synthetic-private-key-do-not-log'
  const message = 'synthetic-private-message-do-not-log'
  let ip = 0
  class Reply extends EventEmitter {
    headers = {}
    statusCode = 200
    writableEnded = false
    setHeader(name, value) { this.headers[name.toLowerCase()] = value }
    status(code) { this.statusCode = code; return this }
    json(value) { this.payload = value; this.writableEnded = true; return this }
    end(value) { this.payload = value; this.writableEnded = true; return this }
  }
  async function request(stub, provider = 'gemini') {
    globalThis.fetch = async (url, options) => { requests.push({ url, options }); return stub() }
    const res = new Reply()
    await handler({ method: 'POST', headers: { host: 'party.example', 'x-forwarded-for': 'test-' + (++ip) }, body: { provider, presentation: 'standard', messages: [{ role: 'user', content: message }] } }, res)
    assert.equal(res.headers['x-penny-provider'], provider)
    return res
  }
  function latest(category) { assert.equal(logs.at(-1)?.[1]?.category, category) }
  function ok(data) { return new Response(JSON.stringify(data), { status: 200 }) }
  try {
    Object.assign(process.env, { PENNY_EXTERNAL_PROVIDERS: '1', GEMINI_API_KEY: secret, PENNY_GEMINI_MODEL: 'test-model', XAI_API_KEY: secret, PENNY_GROK_MODEL: 'test-model' })
    console.warn = (...args) => logs.push(args)
    await t.test('Gemini plain text, no thought leakage', async () => {
      const res = await request(() => ok({ candidates: [{ content: { parts: [{ text: 'hidden', thought: true }, null, { text: 'Hello' }] } }] }))
      assert.equal(res.statusCode, 200); assert.equal(res.payload, 'Hello')
      assert.match(requests.at(-1).url, /^https:\/\/generativelanguage\.googleapis\.com\//)
      assert.equal(requests.at(-1).options.headers['x-goog-api-key'], secret)
    })
    await t.test('HTTP rejection and rate limit', async () => {
      const denied = await request(() => new Response(secret, { status: 403 }))
      assert.equal(denied.statusCode, 502); latest('upstream_http'); assert.equal(logs.at(-1)[1].status, 403)
      const limited = await request(() => new Response(secret, { status: 429 }))
      assert.equal(limited.statusCode, 429); latest('upstream_http')
    })
    await t.test('invalid JSON and malformed or empty response', async () => {
      const invalid = await request(() => new Response('invalid ' + secret))
      assert.equal(invalid.statusCode, 502); latest('invalid_json')
      for (const data of [null, { candidates: [{ content: { parts: {} } }] }, { candidates: [] }]) {
        const empty = await request(() => ok(data))
        assert.equal(empty.statusCode, 502); latest('empty_reply')
      }
    })
    await t.test('transport cause is allowlisted, timeout distinguished', async () => {
      const failed = await request(() => { throw new TypeError(secret, { cause: { code: 'ENOTFOUND' } }) })
      assert.equal(failed.statusCode, 502); latest('transport_failure'); assert.equal(logs.at(-1)[1].code, 'ENOTFOUND')
      const timeout = await request(() => { throw new DOMException(secret, 'AbortError') })
      assert.equal(timeout.statusCode, 504); latest('timeout')
      await request(() => { throw new TypeError(secret, { cause: { code: secret } }) })
      latest('transport_failure'); assert.equal(logs.at(-1)[1].code, undefined)
    })
    await t.test('public Grok is disabled even with configured credentials', async () => {
      const before = requests.length
      const res = await request(() => { throw new Error('No upstream call allowed') }, 'grok')
      assert.equal(res.statusCode, 503)
      assert.match(res.payload.error, /temporarily disabled/)
      assert.equal(requests.length, before)
    })
    assert.equal(requests.length, 10)
    assert.ok(requests.every(entry => entry.url.includes('generativelanguage.googleapis.com')))
    assert.ok(!JSON.stringify(logs).includes(secret))
    assert.ok(!JSON.stringify(logs).includes(message))
  } finally {
    globalThis.fetch = fetchBefore
    console.warn = warnBefore
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key]
      else process.env[key] = saved[key]
    }
  }
})
