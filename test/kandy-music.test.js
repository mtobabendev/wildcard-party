import test from 'node:test'
import assert from 'node:assert/strict'
import { validMediaType } from '../lib/afterhours-media.js'
import { browserMediaType } from '../src/afterhours/ownerEditorRecovery.js'
import { groupPrivateMedia } from '../src/afterhours/mediaCollections.js'

test('private music uploads accept MP3 while excluding unapproved types', () => {
  assert.equal(validMediaType('audio/mpeg'), 'audio/mpeg')
  assert.equal(validMediaType('audio/mp3'), '')
  assert.equal(validMediaType('text/html'), '')
  assert.equal(browserMediaType('', 'Kandy Song.mp3'), 'audio/mpeg')
  assert.equal(browserMediaType('application/octet-stream', 'Kandy Song.mp3'), 'audio/mpeg')
  assert.equal(browserMediaType('audio/mp3', 'Kandy Song.mp3'), 'audio/mpeg')
})

test('music stays separate from private photos and reels', () => {
  const media = [
    { id:'1', type:'audio/mpeg', name:'wc-vault__Music__Kandy Song.mp3' },
    { id:'2', type:'image/jpeg', name:'portrait.jpg' },
    { id:'3', type:'video/mp4', name:'reel.mp4' },
  ]
  const music = groupPrivateMedia(media, 'music')
  assert.equal(music.length, 1)
  assert.equal(music[0].name, 'Music')
  assert.deepEqual(music[0].items.map(item => item.title), ['Kandy Song'])
  assert.equal(groupPrivateMedia(media, 'reels').length, 1)
  assert.deepEqual(groupPrivateMedia(media, 'galleries').flatMap(group => group.items).map(item => item.id), ['2','3'])
})
