import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { LEGACY_PENNY_ASSETS, legacyPennyAsset } from '../lib/afterhours-legacy-catalog.js'
import handler from '../api/afterhours/import-legacy.js'

function response() {
  return {
    statusCode: 200, headers: {},
    setHeader(key, value) { this.headers[key] = value; return this },
    status(code) { this.statusCode = code; return this },
    json(value) { this.body = value; return this },
  }
}
const request = (method, body, origin) => ({
  method, body, headers: { host: 'party.wildcarddev.com', ...(origin ? { origin } : {}) }, cookies: {},
})

test('migration sources are an immutable 39-file Penny-only allowlist', () => {
  assert.equal(LEGACY_PENNY_ASSETS.length, 39)
  assert.equal(new Set(LEGACY_PENNY_ASSETS.map(item => item.name)).size, 39)
  assert.equal(legacyPennyAsset('snow-bird-slides.webp')?.path, '/static/friends/snow-bird-slides.webp')
  assert.equal(legacyPennyAsset('Yoga.mp4')?.path, '/static/penny-classic-cards/Yoga.mp4')
  assert.equal(legacyPennyAsset('1.jpg')?.path, '/static/1.jpg')
  for (const item of LEGACY_PENNY_ASSETS) {
    assert.match(item.path, /^\/static\//)
    assert.doesNotMatch(item.path, /\.\.|\?|#/)
    assert.ok(['image/jpeg', 'image/webp', 'video/webm', 'video/mp4'].includes(item.type))
  }
  assert.equal(legacyPennyAsset('../api/secrets'), null)
  assert.equal(legacyPennyAsset('https://example.com'), null)
  assert.equal(legacyPennyAsset('Penny.gif'), null)
})

test('import endpoint is POST-only and rejects cross-origin requests before auth', async () => {
  const wrongMethod = response()
  await handler(request('GET'), wrongMethod)
  assert.equal(wrongMethod.statusCode, 405)
  const foreign = response()
  await handler(request('POST', { action: 'import', name: '1.jpg' }, 'https://untrusted.example'), foreign)
  assert.equal(foreign.statusCode, 403)
})

test('without an Owner session no inventory, private bucket probes or imports are run', async () => {
  for (const action of ['status', 'probe', 'import']) {
    const denied = response()
    await handler(request('POST', { action, name: '1.jpg' }), denied)
    assert.equal(denied.statusCode, 401)
    assert.match(denied.headers['Cache-Control'], /no-store/)
  }
})

test('Owner UI offers only a resumable migration after bucket verification', () => {
  const ui = readFileSync(new URL('../src/afterhours/OwnerMedia.jsx', import.meta.url), 'utf8')
  assert.match(ui, /action: 'probe'/)
  assert.match(ui, /action: 'status'/)
  assert.match(ui, /action: 'import'/)
  assert.match(ui, /onClick=\{importExistingPennyMedia\}/)
  assert.match(ui, /initial\.missing/)
})
