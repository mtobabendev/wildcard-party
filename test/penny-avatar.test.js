import test from 'node:test'
import assert from 'node:assert/strict'
import { bindAvatarPlayback } from '../src/components/penny-avatar-playback.js'

function fixture({ hidden = false, reduced = false } = {}) {
  const page = Object.assign(new EventTarget(), { hidden })
  const motion = Object.assign(new EventTarget(), { matches: reduced })
  const video = Object.assign(new EventTarget(), {
    src: '', muted: false, plays: 0, pauses: 0, loads: 0,
    play() { this.plays++; return Promise.resolve() },
    pause() { this.pauses++ },
    removeAttribute(name) { assert.equal(name, 'src'); this.src = '' },
    load() { this.loads++ },
  })
  return { page, motion, video }
}

test('active visible avatar starts muted and cleanup releases the source', () => {
  const { page, motion, video } = fixture()
  const dispose = bindAvatarPlayback(video, '/avatar.webm', page, motion)
  assert.equal(video.src, '/avatar.webm')
  assert.equal(video.muted, true)
  assert.equal(video.plays, 1)
  dispose()
  assert.equal(video.src, '')
  assert.equal(video.loads, 1)
  assert.equal(video.pauses, 1)
  page.dispatchEvent(new Event('visibilitychange'))
  motion.dispatchEvent(new Event('change'))
  assert.equal(video.plays, 1)
})

test('hidden page never starts a video; visibility changes release and restore', () => {
  const { page, motion, video } = fixture({ hidden: true })
  const dispose = bindAvatarPlayback(video, '/avatar.webm', page, motion)
  assert.equal(video.src, '')
  assert.equal(video.plays, 0)
  page.hidden = false
  page.dispatchEvent(new Event('visibilitychange'))
  assert.equal(video.src, '/avatar.webm')
  assert.equal(video.plays, 1)
  page.hidden = true
  page.dispatchEvent(new Event('visibilitychange'))
  assert.equal(video.src, '')
  assert.equal(video.loads, 1)
  page.hidden = false
  page.dispatchEvent(new Event('visibilitychange'))
  assert.equal(video.plays, 2)
  dispose()
})

test('reduced motion uses only the poster and changing preference stops playback', () => {
  const { page, motion, video } = fixture({ reduced: true })
  const dispose = bindAvatarPlayback(video, '/avatar.webm', page, motion)
  assert.equal(video.src, '')
  assert.equal(video.plays, 0)
  motion.matches = false
  motion.dispatchEvent(new Event('change'))
  assert.equal(video.plays, 1)
  motion.matches = true
  motion.dispatchEvent(new Event('change'))
  assert.equal(video.src, '')
  assert.equal(video.loads, 1)
  dispose()
  assert.equal(video.loads, 1)
})

test('media errors fall back to the poster; reopening creates a fresh controller', () => {
  const { page, motion, video } = fixture()
  const dispose = bindAvatarPlayback(video, '/avatar.webm', page, motion)
  video.dispatchEvent(new Event('error'))
  assert.equal(video.src, '')
  assert.equal(video.loads, 1)
  dispose()
  const reopen = bindAvatarPlayback(video, '/avatar.webm', page, motion)
  assert.equal(video.src, '/avatar.webm')
  assert.equal(video.plays, 2)
  reopen()
  assert.equal(video.src, '')
})
