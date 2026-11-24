import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { decodeRelayBytes, RELAY_MAX_BYTES } from '../lib/afterhours-upload-bytes.js'

test('relay accepts exact canonical bytes under the request limit', () => {
  const bytes = Buffer.alloc(1848705, 17)
  assert.deepEqual(decodeRelayBytes(bytes.toString('base64'), bytes.length), bytes)
  assert.equal(decodeRelayBytes(bytes.toString('base64'), bytes.length - 1), null)
  assert.equal(decodeRelayBytes('!!!!', 3), null)
  assert.equal(decodeRelayBytes('YQ==', 0), null)
  assert.equal(decodeRelayBytes('YQ==', RELAY_MAX_BYTES + 1), null)
})
test('relay uses the same Owner origin gate and verifies object before making it ready', () => {
  const api = readFileSync(new URL('../api/afterhours/media-admin.js', import.meta.url), 'utf8')
  const db = readFileSync(new URL('../lib/afterhours-media.js', import.meta.url), 'utf8')
  const ui = readFileSync(new URL('../src/afterhours/OwnerMedia.jsx', import.meta.url), 'utf8')
  assert.match(api, /if \(body.action === 'relay'\) \{\s*if \(!ownerBrowser \|\| !req.headers.origin\)/)
  assert.match(db, /Body: bytes, ContentLength: bytes.length/)
  assert.match(db, /return finishPrivateUpload\(actor, id\)/)
  assert.match(ui, /file.size <= RELAY_MAX_BYTES/)
  assert.match(ui, /action: 'relay'/)
  assert.match(ui, /action: 'start'/)
})
