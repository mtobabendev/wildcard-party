import test from 'node:test'
import assert from 'node:assert/strict'
import { BRIDGE, parentOrigin, validParentEvent, unreadCount } from '../src/comms/messenger-bridge.js'

test('Messenger framing accepts only enumerated canonical origins', () => {
  assert.equal(parentOrigin('https://www.wildcarddev.com'), 'https://www.wildcarddev.com')
  for (const origin of ['https://evil.wildcarddev.com', 'https://www.wildcarddev.com.evil.test', 'https://pennytube.vercel.app', 'http://www.wildcarddev.com', null]) assert.equal(parentOrigin(origin), null)
})
test('Messenger bridge rejects wrong origin, window, type and nonboolean state', () => {
  const parent = {}, origin = 'https://www.wildcarddev.com'
  const event = { origin, source: parent, data: { type: BRIDGE + 'state', open: true, visible: true } }
  assert.equal(validParentEvent(event, origin, parent), true)
  assert.equal(validParentEvent({ ...event, origin: 'https://evil.test' }, origin, parent), false)
  assert.equal(validParentEvent({ ...event, source: {} }, origin, parent), false)
  assert.equal(validParentEvent({ ...event, data: { ...event.data, open: 'true' } }, origin, parent), false)
  assert.equal(validParentEvent({ ...event, data: { ...event.data, type: 'other' } }, origin, parent), false)
})
test('Only nonnegative safe integer unread totals are valid', () => {
  for (const value of [0, 1, 100]) assert.equal(unreadCount(value), value)
  for (const value of [-1, NaN, Infinity, 1.5, '1', null]) assert.equal(unreadCount(value), null)
})
