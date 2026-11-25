import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {emptyStripagram,normalizeStripagram} from '../src/afterhours/stripagramModel.js'
import {createContentHandler} from '../api/afterhours/creator-content.js'
test('three separate creator defaults and existing demo fields are editable',()=>{
 for(const area of ['penny','kandy','ashley']){const c=emptyStripagram(area);assert.equal(c.profile.handle,area);assert.deepEqual(normalizeStripagram(c),c)}
 assert.equal(emptyStripagram('penny').posts.length,3)
 assert.equal(emptyStripagram('kandy').posts.length,3)
 assert.equal(emptyStripagram('ashley').posts.length,0)
 const c=emptyStripagram('penny');c.posts[0].spot='url(bad)';assert.equal(normalizeStripagram(c),null)
})
test('stripagram reads and writes are isolated and still require creator grants',async()=>{
 const handler=createContentHandler({account:async()=>({id:'user'}),owner:()=>false,grant:async()=>false,list:async()=>[],stripRead:async()=>{throw Error('must not read')}})
 const req={method:'GET',headers:{},query:{area:'ashley',surface:'stripagram'}}
 const res={setHeader(){},status(n){this.code=n;return this},json(d){this.data=d;return this}}
 await handler(req,res);assert.equal(res.code,403)
 const allow=createContentHandler({account:async()=>({id:'user'}),owner:()=>true,list:async()=>[],read:async()=>{throw Error('wrong surface')},stripRead:async area=>({revision:0,content:emptyStripagram(area)})})
 await allow(req,res);assert.equal(res.code,200);assert.equal(res.data.content.profile.handle,'ashley')
})
test('profile page consumes scoped configuration without inserting HTML',()=>{
 const html=readFileSync(new URL('../public/stripagram/index.html',import.meta.url),'utf8')
 assert.match(html,/surface=stripagram&area=/)
 assert.match(html,/Object.hasOwn\(people,requestedProfile\)/)
 assert.match(html,/managed\.get\(person\)/)
 assert.doesNotMatch(html,/\.innerHTML\s*=/)
})
