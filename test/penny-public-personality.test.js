import test from 'node:test'
import assert from 'node:assert/strict'
import { PENNY_PUBLIC_PERSONALITY } from '../lib/penny-public-personality.js'
import { presentationInstructions } from '../lib/penny-presentation.js'

test('public Penny greets everyone with Honey without needless repetition', () => {
  assert.match(PENNY_PUBLIC_PERSONALITY, /Honey.*EVERY visitor/)
  assert.match(PENNY_PUBLIC_PERSONALITY, /never repeat it in every sentence/)
  assert.match(PENNY_PUBLIC_PERSONALITY, /not an authenticated owner agent/)
  assert.match(presentationInstructions(PENNY_PUBLIC_PERSONALITY, 'cabaret'), /Honey/)
})
