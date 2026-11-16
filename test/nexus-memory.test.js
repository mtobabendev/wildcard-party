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

import { mergeRecords, findRecords, handoff, MAX_SELECTED } from '../src/nexus/workbench.js'
test('private in-session search, relevance, pagination merge and exact reviewed restore bundle',()=>{
 const a={id:'9007199254740993',createdAt:'2026-11-15T00:00:00Z',source:'chatgpt',sources:['chatgpt','grok'],title:'PennyCore release',state:'ready',context:'deployment',memory:'',nextStep:'verify'}
 const b={...a,id:'9007199254740994',source:'gemini',sources:['gemini'],title:'Other project',context:'PennyCore deployment'}
 const c={...a,id:'9007199254740995',title:'Merkabah',context:'art'}
 assert.deepEqual(mergeRecords([a,b],[{...a,sources:['chatgpt','gemini','grok']},c]).map(x=>x.id),[c.id,b.id,a.id])
 assert.deepEqual(findRecords([c,b,a],'pennycore deployment').map(x=>x.id),[a.id,b.id])
 assert.deepEqual(findRecords([c,b,a],'pennycore','grok').map(x=>x.id),[a.id])
 assert.equal(findRecords([a,b],'nonexistent').length,0)
 const text=handoff([a,b])
 assert.match(text,/Source: chatgpt, grok/)
 assert.match(text,/untrusted reference/)
 assert.ok(!text.includes(a.id))
 const jsons=text.match(/\{[\s\S]*?\n\}/g)
 assert.deepEqual(importMegaSeed(jsons[0]),{title:a.title,state:a.state,context:a.context,memory:a.memory,nextStep:a.nextStep})
 assert.throws(()=>handoff([]))
 assert.throws(()=>handoff(Array(MAX_SELECTED+1).fill(a)))
 assert.throws(()=>handoff(Array(6).fill({...a,state:'s'.repeat(2000),context:'c'.repeat(4000),memory:'m'.repeat(4000),nextStep:'n'.repeat(2000)})))
})

import {bridgeConfig,acceptDraft,restoreRecord} from '../src/nexus/bridge.js'
test('continuity popup only accepts exact local origin, opener, transaction and validated draft',()=>{
 const id='11111111-1111-4111-8111-111111111111',origin='http://127.0.0.1:5173',opener={};const cfg=bridgeConfig('?bridge=save&local='+encodeURIComponent(origin)+'&id='+id)
 const packet={title:'Fictional',state:'Synthetic only',context:'',memory:'',nextStep:''},data={type:'nexus:continuity:draft:v1',id,source:'ollama',packet}
 assert.deepEqual(acceptDraft(cfg,{source:opener,origin,data},opener),{source:'ollama',...packet})
 for(const e of [{source:{},origin,data},{source:opener,origin:'https://evil.example',data},{source:opener,origin,data:{...data,id:'wrong'}}])assert.equal(acceptDraft(cfg,e,opener),null)
 assert.equal(bridgeConfig('?bridge=save&local=https://evil.example&id='+id),null)
 assert.equal(bridgeConfig('?bridge=save&local='+encodeURIComponent(origin)+'&id='+id+'&id='+id),null)
 assert.throws(()=>restoreRecord({...packet,id:'1',source:'ollama',sources:['gemini'],createdAt:'2026-11-16'}))
 assert.equal(restoreRecord({...packet,id:'1',source:'ollama',sources:['ollama'],createdAt:'2026-11-16'}).title,'Fictional')
})

import {restoreBundle,acceptBridgeMessage} from '../src/nexus/bridge.js'
test('multi-select bundle, duplicate and size guards, and verified local acknowledgement',()=>{
 const p={title:'Fictional',state:'Synthetic only',context:'',memory:'',nextStep:'',source:'ollama',sources:['ollama'],createdAt:'2026-11-16'}
 const rows=[{...p,id:'1'},{...p,id:'2'}]
 assert.equal(restoreBundle(rows).length,2);assert.throws(()=>restoreBundle([rows[0],rows[0]]));assert.throws(()=>restoreBundle([]));assert.throws(()=>restoreBundle(Array.from({length:7},(_,i)=>({...p,id:String(i+1)}))))
 const id='11111111-1111-4111-8111-111111111111',origin='http://127.0.0.1:5173',opener={},cfg={id,origin,mode:'restore'},data={type:'nexus:continuity:ack:v2',id,ok:true,sessionId:id,count:2}
 assert.equal(acceptBridgeMessage(cfg,{source:opener,origin,data},opener).count,2)
 assert.equal(acceptBridgeMessage(cfg,{source:{},origin,data},opener),null)
 assert.equal(acceptBridgeMessage(cfg,{source:opener,origin,data:{...data,count:0}},opener),null)
})
