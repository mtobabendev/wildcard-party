import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { parsePacket,encryptPacket,decryptPacket,memoryReady,packetDigest } from '../lib/nexus-memory-state.js'
import { createNexusMemoryHandler } from '../lib/nexus-memory-handler.js'
const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222'
const key=randomBytes(32),env={VERCEL_ENV:'production',PENNYCORE_OWNER_ACCOUNT_ID:owner,NEXUS_MEMORY_ENABLED:'1',NEXUS_MEMORY_DATABASE_URL:'synthetic',NEXUS_MEMORY_KEY:key.toString('base64')}
const packet=()=>({requestId:randomUUID(),source:'gemini',title:'Synthetic capture',state:'ready',context:'example',memory:'decision',nextStep:'verify'})
test('authenticated encryption, no plaintext, account and request scope, tamper rejection',()=>{
 const p=parsePacket(packet()),e=encryptPacket(p,owner,key)
 assert.notEqual(e,encryptPacket(p,owner,key));assert.ok(!e.includes(p.title))
 assert.deepEqual(decryptPacket(e,owner,p.requestId,key),p)
 assert.throws(()=>decryptPacket(e,other,p.requestId,key));assert.throws(()=>decryptPacket(e,owner,randomUUID(),key))
 const parts=e.split('.'),b=Buffer.from(parts[3],'base64');b[0]^=1;parts[3]=b.toString('base64')
 assert.throws(()=>decryptPacket(parts.join('.'),owner,p.requestId,key))
 assert.throws(()=>parsePacket({...p,memory:'password: synthetic-secret'}))
 assert.throws(()=>parsePacket({...p,accountId:other}))
 assert.equal(memoryReady({...env,VERCEL_ENV:'preview'}),false)
})
function fixture(overrides={}){
 const rows=[],calls=[],receipts=[]
 const store={
 async list(account,before){calls.push('list');return rows.filter(r=>r.account===account&&(!before||+r.id<+before)).reverse().slice(0,21)},
 async append(account,requestId,envelope,digest,source){calls.push('append');const prior=receipts.find(r=>r.account===account&&r.requestId===requestId);if(prior&&(prior.digest!==digest||prior.source!==source))return {conflict:true};let row=rows.find(r=>r.account===account&&r.content_digest===digest);const duplicate=!!row;if(!row){row={account,request_id:requestId,envelope,content_digest:digest,sources:[],id:String(rows.length+1),created_at:'2026-11-15T00:00:00Z'};rows.push(row)}if(!prior)receipts.push({account,requestId,digest,source});row.sources=[...new Set([...row.sources,source])].sort();return {row,duplicate}}

 }
 const h=createNexusMemoryHandler({currentAccount:async r=>r.account?{id:r.account}:null,sameOrigin:r=>!r.foreign,env:{...env,...overrides},store})
 async function req(account,method='GET',query={view:'status'},body,extra={}){
  const headers={},res={setHeader(k,v){headers[k]=v},status(code){this.code=code;return this},json(payload){this.payload=payload;return this}}
  await h({account,method,query,body,headers:{origin:'https://party.wildcarddev.com','content-type':'application/json'},...extra},res)
  return {code:res.code,body:res.payload,headers}
 }
 return {req,rows,calls}
}
test('owner gate and production activation fail closed before storage',async()=>{
 const f=fixture()
 assert.equal((await f.req(null)).code,401);assert.equal((await f.req(other)).code,403)
 assert.equal((await f.req(owner,'POST',{},packet(),{headers:{'content-type':'application/json'}})).code,403)
 assert.equal((await f.req(owner,'GET',{view:'records'},null,{foreign:true})).code,403)
 assert.equal((await f.req(owner)).body.memoryReady,true)
 assert.equal(f.calls.length,0)
 const preview=fixture({VERCEL_ENV:'preview'})
 assert.equal((await preview.req(owner)).body.memoryReady,false)
 assert.equal((await preview.req(owner,'POST',{},packet())).code,503);assert.equal(preview.calls.length,0)
})
test('capture persists encrypted, retry is idempotent, different content conflicts, records are paginated',async()=>{
 const f=fixture(),p=packet()
 let r=await f.req(owner,'POST',{},p);assert.equal(r.code,201);assert.equal(r.body.record.title,p.title);assert.equal(r.headers['Cache-Control'],'private, no-store')
 assert.ok(!JSON.stringify(f.rows).includes(p.title));assert.ok(!JSON.stringify(r.body).includes('envelope'))
 r=await f.req(owner,'POST',{},p);assert.equal(r.code,200);assert.equal(r.body.duplicate,true)
 assert.equal((await f.req(owner,'POST',{}, {...p,title:'different'})).code,409);assert.equal(f.rows.length,1)
 const cross=await f.req(owner,'POST',{}, {...p,requestId:randomUUID(),source:'grok'});assert.equal(cross.code,200);assert.deepEqual(cross.body.record.sources,['gemini','grok']);assert.equal(f.rows.length,1);
 for(let i=0;i<21;i++)assert.equal((await f.req(owner,'POST',{}, {...packet(),title:'Capture '+i})).code,201)
 r=await f.req(owner,'GET',{view:'records'});assert.equal(r.body.records.length,20);assert.ok(r.body.nextBefore)
 const older=await f.req(owner,'GET',{view:'records',before:r.body.nextBefore});assert.equal(older.body.records.length,2);assert.equal(older.body.nextBefore,null)
 assert.equal((await f.req(owner,'GET',{view:'records',before:'-1'})).code,400)
 assert.equal((await f.req(other,'GET',{view:'records'})).code,403)
})

import { importMegaSeed,restoreText } from '../src/nexus/megaseed.js'
test('strict JSON import and restore format',()=>{
 const p={title:'Test',state:'Ready',context:'',memory:'',nextStep:'Verify'}
 assert.deepEqual(importMegaSeed(JSON.stringify(p)),p)
 assert.deepEqual(importMegaSeed('\x60\x60\x60json\n'+JSON.stringify(p)+'\n\x60\x60\x60'),p)
 assert.throws(()=>importMegaSeed('{"title":"x",'+JSON.stringify(p).slice(1)))
 assert.throws(()=>importMegaSeed(JSON.stringify({...p,source:'grok'})))
 assert.throws(()=>importMegaSeed(JSON.stringify({...p,state:42})))
 assert.throws(()=>importMegaSeed(JSON.stringify({...p,title:'x'.repeat(161)})))
 assert.throws(()=>importMegaSeed(JSON.stringify({...p,memory:'password: fake-secret'})))
 assert.match(restoreText([p]),/Penny, restore point/)
 assert.equal(packetDigest({...p,source:'chatgpt'},owner,key),packetDigest({...p,source:'grok'},owner,key))
 assert.notEqual(packetDigest(p,owner,key),packetDigest(p,other,key))
})
