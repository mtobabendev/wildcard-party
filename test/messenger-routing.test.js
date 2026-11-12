import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8')
test('standalone route shares Party identity and existing COMMS', () => {
  const entry = read('src/main.jsx')
  const view = read('src/comms/Messenger.jsx')
  const cfg = JSON.parse(read('vercel.json'))
  assert.ok(entry.includes("=== '/messenger'"))
  for (const path of ['/api/auth/me', '/api/auth/login', '/api/auth/logout']) assert.ok(view.includes(path))
  assert.ok(view.includes('textOnly'))
  assert.ok(view.includes("credentials: 'same-origin'"))
  assert.ok(cfg.rewrites.some(r => r.source === '/messenger' && r.destination === '/index.html'))
  assert.ok(cfg.headers[0].headers.some(h => h.key === 'X-Frame-Options' && h.value === 'DENY'))
})
test('text-only view omits media and keeps default Party COMMS unchanged', () => {
  const source = read('src/comms/CommsPanel.jsx')
  assert.ok(source.includes('textOnly = false'))
  assert.ok(source.includes('const file = textOnly ? null : attachmentFile'))
  assert.ok(source.includes('const attachment = textOnly ? null : message.attachment'))
  assert.ok(source.includes('{!textOnly && <TwilioCall'))
  assert.ok(source.includes('{!textOnly && <><input'))
})
