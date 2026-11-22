import test from 'node:test'
import assert from 'node:assert/strict'
import { validMediaType, validMediaSize } from '../lib/afterhours-media.js'
import media from '../api/afterhours/media.js'
import ownerMedia from '../api/afterhours/media-admin.js'

function response() {
  return {
    statusCode: 200, headers: {},
    setHeader(key, value) { this.headers[key] = value; return this },
    status(code) { this.statusCode = code; return this },
    json(data) { this.body = data; return this },
  }
}
function request(method, query = {}, headers = {}) {
  return { method, query, headers: { host: 'party.wildcarddev.com', ...headers }, cookies: {} }
}

test('private vault accepts only bounded image and video types', () => {
  for (const mime of ['video/mp4', 'video/webm', 'image/jpeg', 'image/png', 'image/webp', 'image/gif']) {
    assert.equal(validMediaType(mime), mime)
  }
  for (const mime of ['image/svg+xml', 'text/html', 'application/javascript', 'application/pdf', '', 'video/quicktime']) {
    assert.equal(validMediaType(mime), '')
  }
  assert.equal(validMediaSize(1), true)
  assert.equal(validMediaSize(150 * 1024 * 1024), true)
  assert.equal(validMediaSize(0), false)
  assert.equal(validMediaSize(150 * 1024 * 1024 + 1), false)
  assert.equal(validMediaSize(Infinity), false)
})

test('private media endpoint rejects invalid IDs, invalid areas, and unauthenticated requests', async () => {
  const bad = response()
  await media(request('GET', { id: 'not-a-uuid' }), bad)
  assert.equal(bad.statusCode, 400)
  const area = response()
  await media(request('GET', { area: 'penny' }), area)
  assert.equal(area.statusCode, 401)
  const byId = response()
  await media(request('GET', { id: '123e4567-e89b-12d3-a456-426614174000' }), byId)
  assert.equal(byId.statusCode, 401)
})

test('private upload endpoint denies non-owner, cross-site, and wrong methods before DB or storage', async () => {
  const guest = response()
  await ownerMedia(request('POST'), guest)
  assert.equal(guest.statusCode, 401)
  const foreign = response()
  await ownerMedia(request('POST', {}, { origin: 'https://example.invalid' }), foreign)
  assert.equal(foreign.statusCode, 403)
  const method = response()
  await ownerMedia(request('GET'), method)
  assert.equal(method.statusCode, 405)
})
