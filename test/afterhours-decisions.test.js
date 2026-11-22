import test from 'node:test'
import assert from 'node:assert/strict'
import { createAccessHandler } from '../api/afterhours/access.js'

const alice = { id: '123e4567-e89b-12d3-a456-426614174000', handle: 'alice' }
const owner = { id: '123e4567-e89b-12d3-a456-426614174001', handle: 'owner' }
function response() {
  return {
    statusCode: 200, headers: {},
    setHeader(key, value) { this.headers[key] = value; return this },
    status(code) { this.statusCode = code; return this },
    json(data) { this.body = data; return this },
  }
}
const req = area => ({ method: 'GET', query: { area } })
async function check(deps, area) {
  const res = response()
  await createAccessHandler(deps)(req(area), res)
  return res
}

test('anonymous browser receives 401 even if grants checker exists', async () => {
  let checked = false
  const res = await check({ getAccount: async () => null,
    hasGrant: async () => { checked = true; return true }, ownerCheck: () => false }, 'penny')
  assert.equal(res.statusCode, 401)
  assert.equal(checked, false)
})

test('signed in user with no grant is denied', async () => {
  const res = await check({ getAccount: async () => alice,
    hasGrant: async () => false, ownerCheck: () => false }, 'penny')
  assert.equal(res.statusCode, 403)
  assert.equal(res.body.allowed, false)
})

test('Penny-only grant does not unlock Kandy or Ashley', async () => {
  const deps = { getAccount: async () => alice,
    hasGrant: async (_, area) => area === 'penny', ownerCheck: () => false }
  const yes = await check(deps, 'penny')
  assert.equal(yes.statusCode, 200)
  assert.equal(yes.body.allowed, true)
  for (const area of ['kandy', 'ashley']) {
    const no = await check(deps, area)
    assert.equal(no.statusCode, 403, area)
  }
})

test('owner permission is based on server-side identity and bypasses grants', async () => {
  const env = { PENNYCORE_OWNER_ACCOUNT_ID: owner.id }
  let grantCalled = false
  const deps = { getAccount: async () => owner,
    hasGrant: async () => { grantCalled = true; return false },
    ownerCheck: (account, cfg) => account.id === cfg.PENNYCORE_OWNER_ACCOUNT_ID, env }
  for (const area of ['penny', 'kandy', 'ashley']) {
    const res = await check(deps, area)
    assert.equal(res.statusCode, 200)
  }
  assert.equal(grantCalled, false)
})

test('grant backend failure results in fail-closed 503', async () => {
  const res = await check({ getAccount: async () => alice,
    hasGrant: async () => { throw Error('synthetic outage') },
    ownerCheck: () => false }, 'penny')
  assert.equal(res.statusCode, 503)
  assert.equal(res.body.allowed, undefined)
})
