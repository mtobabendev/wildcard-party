import test from 'node:test'
import assert from 'node:assert/strict'
import { parseMediaPage, nextMediaPage, MEDIA_PAGE_SIZE } from '../lib/media-paging.js'
import { listAllPrivateMedia } from '../lib/afterhours-media.js'
import { newUploadProvider, storageProviderForKey, requireSafeMusicStorage } from '../lib/media-storage-routing.js'
import { fetchPrivateMediaPages } from '../src/afterhours/privateMediaPages.js'
import mediaHandler from '../api/afterhours/media.js'

function response() {
  return {
    statusCode:200, headers:{},
    setHeader(key,value){this.headers[key]=value;return this},
    status(code){this.statusCode=code;return this},
    json(body){this.body=body;return this},
  }
}
const request=(query={})=>({method:'GET',query,headers:{host:'party.wildcarddev.com'},cookies:{}})

test('bounded page parsing is strict and untrusted pages do not bypass authentication', async () => {
  assert.equal(parseMediaPage(undefined),0)
  for(const [input,expected] of [['0',0],['1',1],['99',99],['',null],['-1',null],['01',null],['100',null],['1.0',null],['NaN',null]]) {
    assert.equal(parseMediaPage(input),expected)
  }
  assert.equal(parseMediaPage(['0']),null)
  assert.equal(nextMediaPage(0,MEDIA_PAGE_SIZE),1)
  assert.equal(nextMediaPage(1,8),null)
  const invalid=response()
  await mediaHandler(request({area:'kandy',page:'100'}),invalid)
  assert.equal(invalid.statusCode,400)
  const guest=response()
  await mediaHandler(request({area:'kandy',page:'1'}),guest)
  assert.equal(guest.statusCode,401)
  assert.equal(guest.headers['Cache-Control'],'private, no-store')
})

test('browser fetches all 251 items with duplicate protection and same-origin credentials', async () => {
  const items=Array.from({length:251},(_,i)=>({id:String(i+1),name:'track'+(i+1)+'.mp3',type:'audio/mpeg'}))
  const requests=[]
  async function fetcher(url,options) {
    const page=Number(new URL('https://party.wildcarddev.com'+url).searchParams.get('page'))
    requests.push({page,options})
    const media=items.slice(page*100,(page+1)*100)
    if(page===1) media[0]=items[99] // Concurrent-page duplicate is deduplicated, not rendered twice.
    return {ok:true,async json(){return {media,nextPage:media.length===100?page+1:null}}}
  }
  const result=await fetchPrivateMediaPages('kandy',{fetcher})
  assert.deepEqual(requests.map(x=>x.page),[0,1,2])
  assert.ok(requests.every(x=>x.options.credentials==='same-origin'&&x.options.cache==='no-store'))
  assert.equal(result.length,250)
  assert.equal(result[0].id,'1')
  assert.equal(result.at(-1).id,'251')
})

test('browser rejects failed later pages without displaying incomplete results', async () => {
  let count=0
  await assert.rejects(fetchPrivateMediaPages('kandy',{fetcher:async()=>{
    count++
    return count===1 ? {ok:true,async json(){return {media:Array.from({length:100},(_,i)=>({id:String(i)})),nextPage:1}}}
      : {ok:false,async json(){return {error:'Membership required'}}}
  }}),/Membership required/)
  assert.equal(count,2)
  await assert.rejects(fetchPrivateMediaPages('kandy',{fetcher:async()=>({ok:true,async json(){return {media:[],nextPage:0}}})}),/Invalid media page/)
})

test('Owner content operations collect all private IDs, not first 100', async () => {
  const all=Array.from({length:206},(_,i)=>({id:String(i),type:'image/jpeg'}))
  const pages=[]
  const items=await listAllPrivateMedia('kandy',async(area,page)=>{
    assert.equal(area,'kandy')
    pages.push(page)
    return all.slice(page*100,(page+1)*100)
  })
  assert.equal(items.length,206)
  assert.deepEqual(pages,[0,1,2])
})

test('music uploads fail closed if new provider is legacy Neon, while old keys retain their route', () => {
  assert.equal(newUploadProvider({PARTY_MEDIA_STORAGE_PROVIDER:'supabase'}),'supabase')
  assert.equal(storageProviderForKey('afterhours-v2/kandy/uuid'),'supabase')
  assert.equal(storageProviderForKey('afterhours/kandy/uuid-old.mp3'),'legacy')
  assert.equal(requireSafeMusicStorage('audio/mpeg',{PARTY_MEDIA_STORAGE_PROVIDER:'supabase'}),undefined)
  assert.throws(()=>requireSafeMusicStorage('audio/mpeg',{PARTY_MEDIA_STORAGE_PROVIDER:'legacy'}),{code:'STORAGE_NOT_CONFIGURED'})
  assert.throws(()=>requireSafeMusicStorage('audio/mpeg',{}),{code:'STORAGE_NOT_CONFIGURED'})
  assert.equal(requireSafeMusicStorage('image/jpeg',{PARTY_MEDIA_STORAGE_PROVIDER:'legacy'}),undefined)
})
