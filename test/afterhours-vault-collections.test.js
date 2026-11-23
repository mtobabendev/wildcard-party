import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createCollectionName, describePrivateMedia, groupPrivateMedia } from '../src/afterhours/mediaCollections.js'

test('collection naming uses the existing private media display_name without path manipulation', () => {
  const filename = createCollectionName('clip-01.webm', 'Velvet After Dark')
  assert.equal(filename, 'wc-vault__Velvet After Dark__clip-01.webm')
  assert.deepEqual(
    describePrivateMedia({ id: 'sample', name: filename, type: 'video/webm' }).collection,
    'Velvet After Dark',
  )
  assert.equal(createCollectionName('folder\\portrait.jpg', ''), 'portrait.jpg')
  assert.ok(createCollectionName('a'.repeat(190) + '.webm', 'Very Long Series').length <= 180)
})

test('media is separated into galleries and reels without exposing unapproved media', () => {
  const inventory = [
    { id: 'p', name: 'wc-vault__Pink Nights__portrait.webp', type: 'image/webp' },
    { id: 'v', name: 'wc-vault__Pink Nights__clip.webm', type: 'video/webm' },
    { id: 'old', name: '1.jpg', type: 'image/jpeg' },
  ]
  const photos = groupPrivateMedia(inventory, 'galleries')
  const reels = groupPrivateMedia(inventory, 'reels')
  assert.deepEqual(photos.map(g => [g.name, g.items.length]), [['Pink Nights', 1], ['Private Archive', 1]])
  assert.deepEqual(reels.map(g => [g.name, g.items.length]), [['Pink Nights', 1]])
  assert.equal(reels[0].items[0].title, 'clip')
})

test('member gallery fetches through existing authorized APIs and hides all media until approved', () => {
  const view = readFileSync(new URL('../src/afterhours/MemberArea.jsx', import.meta.url), 'utf8')
  const owner = readFileSync(new URL('../src/afterhours/OwnerMedia.jsx', import.meta.url), 'utf8')
  assert.match(view, /fetch\('\/api\/afterhours\/access\?area='/)
  assert.match(view, /fetch\('\/api\/afterhours\/media\?area='/)
  assert.match(view, /status === 'approved' && <>/)
  assert.match(view, /status === 'approved' && current/)
  assert.match(view, /cache: 'no-store'/)
  assert.match(view, /credentials: 'same-origin'/)
  assert.match(view, /aria-pressed={view === 'reels'}/)
  assert.match(owner, /name: createCollectionName\(file\.name, collection\)/)
  assert.match(owner, /action: 'finish', id: ticket\.id/)
})
