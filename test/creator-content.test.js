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
