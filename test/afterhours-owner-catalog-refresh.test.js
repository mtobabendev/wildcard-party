import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8')
test('successful upload batches invalidate the owner catalog',()=>{
 const upload=read('src/afterhours/OwnerMedia.jsx')
 assert.match(upload,/if \(uploaded \|\| skipped\) setMediaRevision\(value => value \+ 1\)/)
 assert.match(upload,/<OwnerContentEditor mediaRevision=\{mediaRevision\}/)
})
test('catalog refresh preserves the current draft and revision',()=>{
 const editor=read('src/afterhours/OwnerContentEditor.jsx')
 const refresh=editor.slice(editor.indexOf('// Refresh only the catalog'),editor.indexOf('  function edit(fn)'))
 assert.match(refresh,/\/api\/afterhours\/media\?area=/)
 assert.match(refresh,/setMedia\(items\)/)
 assert.match(refresh,/\[area,ready,mediaRevision,mediaRefresh\]/)
 assert.doesNotMatch(refresh,/setContent\(|setRevision\(|setDirty\(/)
 assert.match(editor,/onClick=\{refreshMedia\}>Refresh media/)
})
