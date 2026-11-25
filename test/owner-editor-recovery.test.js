import test from 'node:test'
import assert from 'node:assert/strict'
import { mergeCreatorDraft, browserMediaType } from '../src/afterhours/ownerEditorRecovery.js'
test('non-overlapping changes survive stale revisions',()=>{
 const base={bannerId:null,avatarId:null}
 assert.deepEqual(mergeCreatorDraft(base,{...base,avatarId:'mine'},{...base,bannerId:'theirs'}),{content:{bannerId:'theirs',avatarId:'mine'},conflicts:[]})
})
test('overlapping changes never silently overwrite',()=>{
 assert.deepEqual(mergeCreatorDraft({avatarId:null},{avatarId:'mine'},{avatarId:'theirs'}).conflicts,['avatarId'])
})
test('independent orbit slots merge; changed posts conflict',()=>{
 const orbitCards=Array(8).fill(null)
 const base={orbitCards,posts:[]}
 const mine={...base,orbitCards:['mine',...orbitCards.slice(1)],posts:[{id:'a'}]}
 const theirs={...base,orbitCards:[null,'theirs',...orbitCards.slice(2)],posts:[{id:'b'}]}
 const result=mergeCreatorDraft(base,mine,theirs)
 assert.deepEqual(result.content.orbitCards.slice(0,2),['mine','theirs'])
 assert.deepEqual(result.conflicts,['posts'])
})
test('same edit and reordered JSON keys do not conflict',()=>{
 const base={profile:{a:1,b:2}}, draft={profile:{a:3,b:2}}, latest={profile:{b:2,a:3}}
 assert.deepEqual(mergeCreatorDraft(base,draft,latest).conflicts,[])
})
test('Android unspecified file types get extension fallback, not an arbitrary type override',()=>{
 assert.equal(browserMediaType('','clip.MP4'),'video/mp4')
 assert.equal(browserMediaType('application/octet-stream','photo.webp'),'image/webp')
 assert.equal(browserMediaType('text/plain','photo.webp'),'text/plain')
 assert.equal(browserMediaType('','file.exe'),'')
})
