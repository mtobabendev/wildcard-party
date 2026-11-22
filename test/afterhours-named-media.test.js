import test from 'node:test'
import assert from 'node:assert/strict'
import { privateMediaByName } from '../lib/afterhours-media.js'
import handler from '../api/afterhours/media.js'

function response() {
  return {
    statusCode: 200, headers: {},
    setHeader(key, value) { this.headers[key] = value; return this },
    status(code) { this.statusCode = code; return this },
    json(data) { this.body = data; return this },
  }
}
const request = (query) => ({
  method: 'GET', query, headers: { host: 'party.wildcarddev.com' }, cookies: {},
})

test('named media lookup rejects traversal and unknown areas before storage access', async () => {
  assert.equal(await privateMediaByName('unknown', 'photo.jpg'), null)
  assert.equal(await privateMediaByName('penny', '../photo.jpg'), null)
  assert.equal(await privateMediaByName('penny', 'a/b.jpg'), null)
  assert.equal(await privateMediaByName('penny', 'a\\b.jpg'), null)
  assert.equal(await privateMediaByName('penny', ''), null)
})

test('named media requires area and session; ambiguous requests fail closed', async () => {
  const missing = response()
  await handler(request({ name: 'photo.jpg' }), missing)
  assert.equal(missing.statusCode, 400)

  const both = response()
  await handler(request({ area: 'penny', name: 'photo.jpg',
    id: '123e4567-e89b-12d3-a456-426614174000' }), both)
  assert.equal(both.statusCode, 400)

  const denied = response()
  await handler(request({ area: 'penny', name: 'photo.jpg' }), denied)
  assert.equal(denied.statusCode, 401)
  assert.match(denied.headers['Cache-Control'], /no-store/)
})
