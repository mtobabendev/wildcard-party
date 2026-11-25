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

test('galleries mix photos and videos while reels remain video-only without exposing unapproved media', () => {
  const inventory = [
    { id: 'p', name: 'wc-vault__Pink Nights__portrait.webp', type: 'image/webp' },
    { id: 'v', name: 'wc-vault__Pink Nights__clip.webm', type: 'video/webm' },
    { id: 'old', name: '1.jpg', type: 'image/jpeg' },
  ]
  const photos = groupPrivateMedia(inventory, 'galleries')
  const reels = groupPrivateMedia(inventory, 'reels')
  assert.deepEqual(photos.map(g => [g.name, g.items.length]), [['Pink Nights', 2], ['Private Archive', 1]])
  assert.deepEqual(reels.map(g => [g.name, g.items.length]), [['Pink Nights', 1]])
  assert.equal(reels[0].items[0].title, 'clip')
  assert.deepEqual(photos[0].items.map(item => item.type), ['image/webp', 'video/webm'])
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
  assert.match(owner, /const chosenName = \(fileNames\[i\] \|\| ''\)\.trim\(\)/)
  assert.match(owner, /const name = createCollectionName\(chosenName, collection\)/)
  assert.match(owner, /const contentType = browserMediaType\(file\.type, file\.name\)/)
  assert.match(owner, /action: 'start', area, name, contentType,/)
  assert.match(owner, /action: 'relay', area, name, contentType,/)
  assert.ok(owner.indexOf('<section id="private-media-upload"') < owner.indexOf('<OwnerContentEditor mediaRevision='))
  assert.match(owner, /setFileNames\(failedNames\)/)
  assert.match(owner, /Stored filenames \(editable\)/)
  assert.equal(createCollectionName('PennySeatAtTheTableCompanion.webm', ''), 'PennySeatAtTheTableCompanion.webm')
  assert.match(owner, /action: 'finish', id: ticket\.id/)
})

test('compact embedded vault preserves Party-only authentication and exposes height only to trusted site origins', () => {
  const view = readFileSync(new URL('../src/afterhours/MemberArea.jsx', import.meta.url), 'utf8')
  const headers = readFileSync(new URL('../vercel.json', import.meta.url), 'utf8')
  assert.match(view, /get\('embed'\) === '1'/)
  assert.match(view, /vault vault--embedded/)
  assert.match(view, /wildcard:afterhours:height:v1/)
  assert.match(view, /https:\/\/www\.wildcarddev\.com/)
  assert.match(view, /window\.parent\.postMessage\(message, origin\)/)
  assert.match(view, /fetch\('\/api\/afterhours\/access\?area='/)
  assert.match(headers, /frame-ancestors https:\/\/wildcarddev\.com https:\/\/www\.wildcarddev\.com/)
})
