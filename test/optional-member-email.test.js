import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { normalizeOptionalEmail } from '../lib/auth-db.js'
import register from '../api/auth/register.js'

function response() {
  return {
    statusCode: 200,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; return this },
    status(n) { this.statusCode = n; return this },
    json(body) { this.body = body; return this },
  }
}

test('optional email accepts missing, null, blank and whitespace', () => {
  for (const input of [undefined, null, '', '    ']) {
    assert.equal(normalizeOptionalEmail(input), '')
  }
})

test('optional email preserves local part and normalizes domain', () => {
  assert.equal(normalizeOptionalEmail('  Six+Updates@Example.COM '), 'Six+Updates@example.com')
  assert.equal(normalizeOptionalEmail('member@example.org'), 'member@example.org')
})

test('optional email rejects malformed or oversized input', () => {
  const invalid = [false, {}, [], 123, 'member', 'member@', '@example.com', 'member@@example.com',
    'member@example', 'member@example..com', '<member@example.com>', 'x'.repeat(250) + '@example.com',
    'x'.repeat(65) + '@example.com', 'a@example.com\nBcc:x@y.com']
  for (const input of invalid) assert.equal(normalizeOptionalEmail(input), null, String(input))
})

test('self-registration invalid email is rejected before database access', async () => {
  const req = {
    method: 'POST',
    headers: { host: 'party.wildcarddev.com', origin: 'https://party.wildcarddev.com' },
    socket: { remoteAddress: 'email-validation-unit-test' },
    body: { handle: 'new_member_email_test', displayName: 'New Member', password: 'some-pass-12345', email: 'invalid-email' },
  }
  const res = response()
  await register(req, res)
  assert.equal(res.statusCode, 400)
  assert.match(res.body.error, /valid email|leave it blank/i)
})

test('email remains private in account responses and has no implicit opt-in', () => {
  const auth = readFileSync(new URL('../lib/auth-db.js', import.meta.url), 'utf8')
  const serializer = auth.split('function publicAccount(row) {')[1]?.split('export async function registerAccount')[0]
  assert.ok(serializer, 'publicAccount serializer found')
  assert.doesNotMatch(serializer, /email/)
  assert.match(auth, /ALTER TABLE wildcard_accounts ADD COLUMN IF NOT EXISTS email varchar\(254\)/)
  assert.match(auth, /normalizedEmail \|\| null/)
  const api = readFileSync(new URL('../api/auth/register.js', import.meta.url), 'utf8')
  const admin = readFileSync(new URL('../api/afterhours/admin.js', import.meta.url), 'utf8')
  assert.match(api, /registerAccount\(\{ handle, displayName, password, email \}\)/)
  assert.match(admin, /registerAccount\(\{ handle, displayName, password: body.password, email \}\)/)
  const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
  const owner = readFileSync(new URL('../src/afterhours/OwnerAccess.jsx', import.meta.url), 'utf8')
  assert.match(app, /EMAIL ADDRESS \(OPTIONAL\)/)
  assert.match(app, /type="email"/)
  assert.match(owner, /Email address \(optional\)/)
  const list = readFileSync(new URL('../lib/afterhours-access.js', import.meta.url), 'utf8')
  assert.match(list, /email: row.email \|\| ''/)
  assert.doesNotMatch(api, /sendMail|sendEmail|subscribeToMailingList/)
})
