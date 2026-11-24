import test from 'node:test'
import assert from 'node:assert/strict'
import { createCollectionName, describePrivateMedia, groupPrivateMedia, validCollectionLabel } from '../src/afterhours/mediaCollections.js'

test('move overrides the original collection without changing file identity or filename', () => {
  const original = { id: 'one', name: createCollectionName('clip.webm', 'Old Gallery'), type: 'video/webm' }
  const moved = { ...original, collection: 'A Night Out' }
  assert.equal(describePrivateMedia(original).collection, 'Old Gallery')
  assert.equal(describePrivateMedia(moved).displayName, 'clip.webm')
  assert.equal(describePrivateMedia(moved).id, original.id)
  assert.equal(describePrivateMedia(moved).name, original.name)
  assert.deepEqual(groupPrivateMedia([moved], 'galleries').map(group => [group.name, group.items.length]), [['A Night Out', 1]])
  assert.equal(groupPrivateMedia([moved], 'reels')[0].name, 'A Night Out')
})

test('uncategorized items can move and photos and clips share a gallery', () => {
  const photo = { id: 'two', name: 'photo.jpg', type: 'image/jpeg' }
  assert.equal(describePrivateMedia(photo).collection, 'Private Archive')
  const moved = { ...photo, collection: 'Existing Gallery' }
  const clip = { id: 'three', name: createCollectionName('clip.mp4', 'Existing Gallery'), type: 'video/mp4' }
  const groups = groupPrivateMedia([moved, clip], 'galleries')
  assert.equal(groups.length, 1)
  assert.equal(groups[0].items.length, 2)
  assert.equal(groupPrivateMedia([moved, clip], 'reels')[0].items.length, 1)
})

test('invalid gallery names are rejected and malformed overrides fall back', () => {
  for (const name of ['', '   ', '../x', 'x/y', 'a'.repeat(49), null, ' Leading', '___']) assert.equal(validCollectionLabel(name), false)
  assert.equal(validCollectionLabel('A Night Out'), true)
  assert.equal(validCollectionLabel('Gallery_2'), true)
  assert.equal(describePrivateMedia({name: 'photo.jpg', collection: '../x'}).collection, 'Private Archive')
})
