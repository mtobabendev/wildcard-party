import test from 'node:test'
import assert from 'node:assert/strict'
import { emptyContent,normalizeContent,contentMediaValid } from '../src/afterhours/contentModel.js'
const id='12345678-1234-1234-1234-123456789abc'
test('validates content and excludes external links and duplicate post IDs',()=>{
 assert.deepEqual(normalizeContent(emptyContent()),emptyContent())
 const post={id,title:'Hello',body:'Body',mediaId:null,link:'/creators'}
 assert.ok(normalizeContent({bannerId:null,posts:[post]}))
 assert.equal(normalizeContent({bannerId:null,posts:[{...post,link:'//external.test'}]}),null)
 assert.equal(normalizeContent({bannerId:null,posts:[post,post]}),null)
})
test('only catalog images can serve as banners and attachments must exist',()=>{
 assert.equal(contentMediaValid({bannerId:id,posts:[]},[]),false)
 assert.equal(contentMediaValid({bannerId:id,posts:[]},[{id,type:'video/mp4'}]),false)
 assert.equal(contentMediaValid({bannerId:id,posts:[]},[{id,type:'image/png'}]),true)
})

import { createContentHandler } from '../api/afterhours/creator-content.js'
function response(){return {headers:{},code:0,body:null,setHeader(k,v){this.headers[k]=v},status(n){this.code=n;return this},json(v){this.body=v;return this}}}
const req=(method,origin='https://party.wildcarddev.com')=>({method,headers:{origin,host:'party.wildcarddev.com'},query:{area:'penny'},body:{revision:0,content:emptyContent()}})
const deps={account:async()=>({id}),owner:()=>false,grant:async()=>true,list:async()=>[],read:async()=>({revision:0,content:emptyContent()}),save:async()=>({revision:1,content:emptyContent()})}
test('member reads are allowed; writes are owner-only; unapproved members and anonymous visitors denied',async()=>{
 let res=response();await createContentHandler(deps)(req('GET','https://www.wildcarddev.com'),res)
 assert.equal(res.code,200);assert.equal(res.headers['Access-Control-Allow-Origin'],'https://www.wildcarddev.com')
 res=response();await createContentHandler(deps)(req('POST'),res);assert.equal(res.code,403)
 res=response();await createContentHandler({...deps,grant:async()=>false})(req('GET'),res);assert.equal(res.code,403)
 res=response();await createContentHandler({...deps,account:async()=>null})(req('GET'),res);assert.equal(res.code,401)
})
test('owner writes require same origin and stale revisions cannot overwrite',async()=>{
 let res=response();await createContentHandler({...deps,owner:()=>true})(req('POST','https://www.wildcarddev.com'),res);assert.equal(res.code,403)
 res=response();await createContentHandler({...deps,owner:()=>true,save:async()=>null})(req('POST'),res);assert.equal(res.code,409)
 res=response();await createContentHandler({...deps,owner:()=>true})(req('POST'),res);assert.equal(res.code,200)
})

test('optional profile video accepts older records and validates catalog video types',()=>{
 const legacy={bannerId:null,posts:[]}
 assert.deepEqual(normalizeContent(legacy),emptyContent())
 assert.equal(normalizeContent({...legacy,profileVideoId:'bad'}),null)
 const content=normalizeContent({...legacy,profileVideoId:id})
 assert.equal(content.profileVideoId,id)
 assert.equal(contentMediaValid(content,[]),false)
 assert.equal(contentMediaValid(content,[{id,type:'image/png'}]),false)
 assert.equal(contentMediaValid(content,[{id,type:'video/mp4'}]),true)
 assert.equal(contentMediaValid(content,[{id,type:'video/webm'}]),true)
})

test('eight orbit slots support legacy defaults, blank cards and catalog images',()=>{
 const legacy={bannerId:null,posts:[]}
 assert.deepEqual(normalizeContent(legacy).orbitCards,Array(8).fill(null))
 assert.equal(normalizeContent({...legacy,orbitCards:[id]}),null)
 assert.equal(normalizeContent({...legacy,orbitCards:Array(8).fill('invalid')}),null)
 const cards=[id,'blank',null,null,null,null,null,null]
 const content=normalizeContent({...legacy,orbitCards:cards})
 assert.deepEqual(content.orbitCards,cards)
 assert.equal(contentMediaValid(content,[{id,type:'video/mp4'}]),false)
 assert.equal(contentMediaValid(content,[{id,type:'image/png'}]),true)
 assert.equal(contentMediaValid(normalizeContent({...legacy,orbitCards:Array(8).fill('blank')}),[]),true)
})

test('creator media settings are optional, backward compatible and type checked',()=>{
 const legacy={bannerId:null,posts:[]}
 const content=normalizeContent({...legacy,coverVideoId:id,avatarId:id})
 assert.equal(content.coverVideoId,id)
 assert.equal(content.avatarId,id)
 assert.equal(contentMediaValid(content,[{id,type:'video/mp4'}]),true)
 assert.equal(contentMediaValid(content,[{id,type:'image/png'}]),false)
 assert.equal(contentMediaValid(normalizeContent({...legacy,avatarId:id}),[{id,type:'image/webp'}]),true)
 assert.equal(normalizeContent({...legacy,avatarId:'bad'}),null)
})
