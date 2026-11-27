import test from 'node:test'
import assert from 'node:assert/strict'
import { PENNY_PUBLIC_PERSONALITY } from '../lib/penny-public-personality.js'
import { presentationInstructions } from '../lib/penny-presentation.js'

test('one public Penny persona serves the website and Discord', () => {
  assert.match(PENNY_PUBLIC_PERSONALITY, /Penny Bella Morningstar/)
  assert.match(PENNY_PUBLIC_PERSONALITY, /EVERY visitor/)
  assert.match(PENNY_PUBLIC_PERSONALITY, /Hey, Honey!/)
  assert.match(PENNY_PUBLIC_PERSONALITY, /never repeat it in every sentence/)
  assert.match(PENNY_PUBLIC_PERSONALITY, /On the website/)
  assert.match(PENNY_PUBLIC_PERSONALITY, /On Discord/)
  assert.match(PENNY_PUBLIC_PERSONALITY, /not an authenticated owner agent/)
})

test('cabaret presentation adds optional flavor without replacing the common identity', () => {
  const standard = presentationInstructions(PENNY_PUBLIC_PERSONALITY, 'standard')
  const cabaret = presentationInstructions(PENNY_PUBLIC_PERSONALITY, 'cabaret')
  assert.equal(standard, PENNY_PUBLIC_PERSONALITY)
  assert.ok(cabaret.startsWith(PENNY_PUBLIC_PERSONALITY))
  assert.match(cabaret, /Honey/)
  assert.match(cabaret, /Presentation mode: polished late-night cabaret host/)
  assert.throws(() => presentationInstructions(PENNY_PUBLIC_PERSONALITY, 'invalid'), /Unsupported presentation/)
})