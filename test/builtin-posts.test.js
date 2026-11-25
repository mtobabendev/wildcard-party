import test from 'node:test'
import assert from 'node:assert/strict'
import {BUILTIN_POSTS} from '../src/afterhours/builtinPosts.js'
import {emptyContent,normalizeContent,contentMediaValid} from '../src/afterhours/contentModel.js'
const id='11111111-1111-4111-8111-111111111111'
test('all eight original posts have stable IDs',()=>{
 assert.deepEqual(BUILTIN_POSTS.penny.map(p=>p.id),['nurse','velvet','cover','throne','vault','letter'])
 assert.equal(BUILTIN_POSTS.kandy[0].id,'spotlight');assert.equal(BUILTIN_POSTS.ashley[0].id,'spotlight')
 for(const p of Object.values(BUILTIN_POSTS).flat())assert.ok(p.title&&p.body)
})
test('legacy records need no migration; overrides are sparse and area-scoped',()=>{
 const {postOverrides,...legacy}=emptyContent()
 assert.deepEqual(normalizeContent(legacy,'penny'),emptyContent())
 const content={...legacy,postOverrides:{nurse:{title:'Updated',body:'',hidden:false,mediaMode:'original',mediaId:null}}}
 assert.deepEqual(normalizeContent(content,'penny').postOverrides,content.postOverrides)
 assert.equal(normalizeContent(content,'kandy'),null)
 assert.equal(normalizeContent({...legacy,postOverrides:{nurse:{link:'//external.test'}}},'penny'),null)
 assert.equal(normalizeContent({...legacy,postOverrides:{nurse:{mediaMode:'replace',mediaId:null}}},'penny'),null)
})
test('replacement must reference allowed creator media; originals need no catalog media',()=>{
 const value=normalizeContent({...emptyContent(),postOverrides:{nurse:{mediaMode:'replace',mediaId:id}}},'penny')
 assert.equal(contentMediaValid(value,[]),false)
 assert.equal(contentMediaValid(value,[{id,type:'image/webp'}]),true)
 assert.equal(contentMediaValid(normalizeContent({...emptyContent(),postOverrides:{nurse:{mediaMode:'none',mediaId:null}}},'penny'),[]),true)
})
