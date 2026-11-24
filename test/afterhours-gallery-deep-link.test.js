import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
test('collection deep links use existing authorized inventory and select only exact collection', () => {
  const src = readFileSync(new URL('../src/afterhours/MemberArea.jsx', import.meta.url), 'utf8')
  assert.match(src, /get\('collection'\)/)
  assert.match(src, /validCollectionLabel\(requestedCollection\)/)
  assert.match(src, /status === 'approved' \? groupPrivateMedia\(media, view\)\.filter\(group => !selectedCollection \|\| group.name === selectedCollection\)/)
  assert.match(src, /fetch\('\/api\/afterhours\/access\?area='/)
  assert.match(src, /All galleries/)
})
