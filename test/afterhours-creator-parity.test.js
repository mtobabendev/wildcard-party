import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
test('all three creator choices expose the same profile and orbit settings',()=>{
 const s=readFileSync(new URL('../src/afterhours/OwnerContentEditor.jsx',import.meta.url),'utf8')
 assert.match(s,/AREAS=\['penny','kandy','ashley'\]/)
 assert.doesNotMatch(s,/area==='penny'&&<section/)
 for(const id of ['bannerId','coverVideoId','avatarId','profileVideoId','orbitCards']) assert.ok(s.includes('content.'+id))
})
