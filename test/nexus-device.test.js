import test from 'node:test'
import assert from 'node:assert/strict'
import {issueGrant,verifyGrant,createDeviceHandler} from '../lib/nexus-device.js'
const owner='11111111-1111-4111-8111-111111111111',sid='22222222-2222-4222-8222-222222222222',id='33333333-3333-4333-8333-333333333333'
const env={VERCEL_ENV:'production',NEXUS_MEMORY_ENABLED:'1',NEXUS_MEMORY_DATABASE_URL:'synthetic',NEXUS_MEMORY_KEY:Buffer.alloc(32,7).toString('base64'),PENNYCORE_OWNER_ACCOUNT_ID:owner}
test('grant is scope, owner, session and expiry bound; tamper and key rotation fail closed',()=>{
 const now=100,session={id:sid,account:owner,expires:200},g=issueGrant(session,id,env,now)
 assert.equal(g.expires,200);assert.equal(verifyGrant(g.grant,env,now).sid,sid)
 assert.equal(verifyGrant(g.grant,env,200),null);assert.equal(verifyGrant(g.grant+'a',env,now),null);assert.equal(verifyGrant(g.grant,{...env,NEXUS_MEMORY_KEY:Buffer.alloc(32,8).toString('base64')},now),null);assert.equal(verifyGrant(g.grant,{...env,VERCEL_ENV:'preview'},now),null)
 assert.throws(()=>issueGrant({...session,account:id},id,env,now))
})
test('pair requires owner and explicit same-origin approval; bearer uses live session, not cookies',async()=>{
 let active=true,calls=0;const now=Math.floor(Date.now()/1000)
 const handler=createDeviceHandler({env,currentDeviceSession:async()=>({id:sid,account:owner,expires:now+120}),liveDeviceSession:async(s,a)=>active&&s===sid&&a===owner?{id:owner}:null,store:{async list(){calls++;return []}}})
 async function req(method,query,headers={},body){const res={setHeader(){},status(code){this.code=code;return this},json(value){this.body=value;return this}};await handler({method,query,headers,body},res);return res}
 const headers={origin:'https://party.wildcarddev.com','content-type':'application/json'}
 assert.equal((await req('POST',{action:'pair'},{...headers,origin:'https://evil.example'},{deviceId:id,approved:true})).code,403)
 assert.equal((await req('POST',{action:'pair'},headers,{deviceId:id,approved:false})).code,400)
 const pair=await req('POST',{action:'pair'},headers,{deviceId:id,approved:true});assert.equal(pair.code,201)
 const bearer={authorization:'Bearer '+pair.body.grant}
 assert.equal((await req('GET',{view:'records'},bearer)).code,200);assert.equal(calls,1)
 assert.equal((await req('GET',{view:'records'},{...bearer,cookie:'anything'})).code,403)
 assert.equal((await req('GET',{view:'records'},{...bearer,origin:'http://127.0.0.1:5173'})).code,403)
 active=false;assert.equal((await req('GET',{view:'records'},bearer)).code,401);assert.equal(calls,1)
})
