import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { AFTER_HOURS_AREAS, validArea, validAccountId, hasAreaGrant } from '../lib/afterhours-access.js'
import { isOwner } from '../lib/penny-owner.js'
import access from '../api/afterhours/access.js'
import admin from '../api/afterhours/admin.js'

function response() {
  return {
    statusCode: 200,
    headers: {},
    setHeader(key, value) { this.headers[key] = value; return this },
    status(code) { this.statusCode = code; return this },
    json(body) { this.body = body; return this },
  }
}
function request(method = 'GET', query = {}, headers = {}) {
  return { method, query, headers: { host: 'party.wildcarddev.com', ...headers }, cookies: {} }
}

test('exact area allowlist and stable UUID input validation', () => {
  assert.deepEqual(AFTER_HOURS_AREAS, ['penny', 'kandy', 'ashley'])
  assert.equal(validArea('Penny'), '')
  assert.equal(validArea('penny/../'), '')
  assert.equal(validArea('penny'), 'penny')
  assert.equal(validAccountId('spoofed'), '')
  assert.equal(validAccountId('123e4567-e89b-12d3-a456-426614174000'), '123e4567-e89b-12d3-a456-426614174000')
})

test('no invalid target can acquire a grant without even consulting the DB', async () => {
  assert.equal(await hasAreaGrant('other', 'penny'), false)
  assert.equal(await hasAreaGrant('123e4567-e89b-12d3-a456-426614174000', 'not-an-area'), false)
})

test('owner identity uses configured UUID, not a privileged handle', () => {
  const owner = '123e4567-e89b-12d3-a456-426614174000'
  assert.equal(isOwner({ id: owner, handle: 'not-the-owner' }, { PENNYCORE_OWNER_ACCOUNT_ID: owner }), true)
  assert.equal(isOwner({ id: '123e4567-e89b-12d3-a456-426614174001', handle: 'owner' }, { PENNYCORE_OWNER_ACCOUNT_ID: owner }), false)
  assert.equal(isOwner({ id: owner }, {}), false)
})

test('access endpoint rejects invalid areas and requires sign-in', async () => {
  const bad = response()
  await access(request('GET', { area: '../penny' }), bad)
  assert.equal(bad.statusCode, 400)
  const guest = response()
  await access(request('GET', { area: 'penny' }), guest)
  assert.equal(guest.statusCode, 401)
  assert.equal(guest.body.allowed, false)
  assert.match(guest.headers['Cache-Control'], /no-store/)
})

test('Owner admin rejects guest, cross-origin, and non-supported methods', async () => {
  const guest = response()
  await admin(request('GET'), guest)
  assert.equal(guest.statusCode, 401)
  const foreign = response()
  await admin(request('POST', {}, { origin: 'https://stranger.example' }), foreign)
  assert.equal(foreign.statusCode, 403)
  const wrongMethod = response()
  await admin(request('DELETE'), wrongMethod)
  assert.equal(wrongMethod.statusCode, 405)
})

test('bridge only accepts canonical parent origins and runs under strict CSP', () => {
  const html = readFileSync(new URL('../afterhours-bridge.html', import.meta.url), 'utf8')
  const script = readFileSync(new URL('../public/afterhours-bridge.js', import.meta.url), 'utf8')
  const headers = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8')).headers
  const bridge = headers.find(item => item.source === '/afterhours-bridge.html')
  const csp = bridge?.headers.find(item => item.key === 'Content-Security-Policy')?.value
  assert.match(html, /src="\/afterhours-bridge\.js"/)
  assert.doesNotMatch(html, /<script(?:\s[^>]*)?>(?!\s*<\/script>)/)
  assert.match(csp || '', /script-src 'self'/)
  assert.match(script, /event\.origin === parentOrigin/)
  assert.match(script, /event\.source === window\.parent/)
  assert.match(script, /https:\/\/www\.wildcarddev\.com/)
  assert.doesNotMatch(script, /location\.origin\s*\|\|/)
})
