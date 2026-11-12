import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { ownedBy, ownerHash } from '../lib/social-db.js'

const accountId = 'b7e695c0-cdee-4f46-a658-18fa256c62b1'
const otherAccountId = '97d0918c-c60d-44ef-b8b8-fdf8a7fda099'
const guestToken = 'guest-regression-token-0123456789abcdef'
const accountRow = {
  account_id: accountId,
  owner_token_hash: ownerHash('account:' + accountId),
}
const guestRow = {
  account_id: null,
  owner_token_hash: ownerHash(guestToken),
}

test('account-owned content is owned by its authenticated account', () => {
  assert.equal(ownedBy(accountRow, { accountId }), true)
  assert.equal(ownedBy(accountRow, { accountId, ownerToken: guestToken }), true)
})

test('other accounts and unauthenticated visitors cannot claim account-owned content', () => {
  assert.equal(ownedBy(accountRow), false)
  assert.equal(ownedBy(accountRow, { accountId: otherAccountId }), false)
  assert.equal(ownedBy(accountRow, { ownerToken: 'account:' + accountId }), false)
  assert.equal(ownedBy(accountRow, { accountId: otherAccountId, ownerToken: 'account:' + accountId }), false)
})

test('guest ownership still works for unclaimed content', () => {
  assert.equal(ownedBy(guestRow, { ownerToken: guestToken }), true)
  assert.equal(ownedBy(guestRow, { accountId, ownerToken: guestToken }), true)
  assert.equal(ownedBy(guestRow, { accountId }), false)
  assert.equal(ownedBy(guestRow, { ownerToken: 'invalid' }), false)
  assert.equal(ownedBy(guestRow), false)
})

test('all four edit and delete SQL paths scope guest credentials to unclaimed rows', () => {
  const source = readFileSync(new URL('../lib/social-db.js', import.meta.url), 'utf8')
  for (const name of ['updatePost', 'deletePost', 'updateComment', 'deleteComment']) {
    const start = source.indexOf('export async function ' + name + '(')
    assert.notEqual(start, -1, name)
    const end = source.indexOf('\nexport ', start + 1)
    const body = source.slice(start, end < 0 ? undefined : end)
    assert.ok(body.includes('account_id = ${normalizedAccountId}::uuid'), name)
    assert.ok(body.includes('OR (account_id IS NULL AND owner_token_hash = ${hash || null})'), name)
    assert.equal(body.includes('OR owner_token_hash ='), false, name)
  }
})
