import assert from 'node:assert/strict'
import { test } from 'node:test'
import { emptyState, parseAction, appendTurn, modelInput } from '../lib/penny-core-state.js'

test('new account state is empty and independent', () => {
  const a = emptyState(), b = emptyState()
  a.history.push({ role: 'user', content: 'test' })
  assert.deepEqual(b, { revision: 0, notes: '', history: [] })
})
test('rejects invalid revisions, actions and oversized input', () => {
  for (const body of [null, { action: 'chat', revision: -1, message: 'hi' }, { action: 'chat', revision: 0, message: 'x'.repeat(2001) }, { action: 'save-notes', revision: 0, notes: 'x'.repeat(6001) }, { action: 'set-owner', revision: 0 }]) assert.throws(() => parseAction(body))
  assert.deepEqual(parseAction({ action: 'chat', revision: 0, message: ' hello ', accountId: 'other' }), { action: 'chat', revision: 0, message: 'hello' })
})
test('keeps last 40 messages and bounded model context', () => {
  let history = []
  for (let i = 0; i < 25; i++) history = appendTurn(history, 'x'.repeat(2000), 'y'.repeat(2000))
  assert.equal(history.length, 40)
  const input = modelInput({ notes: 'z'.repeat(6000), history }, 'hello')
  assert.ok(input.reduce((sum, item) => sum + item.content.length, 0) <= 12000)
  assert.equal(input.at(-1).content, 'hello')
  assert.equal(input[0].role, 'user')
})
