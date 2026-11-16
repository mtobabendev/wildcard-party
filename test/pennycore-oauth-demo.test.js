import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createOAuthDemoHandler,config,ORIGIN,RESOURCE,SCOPE } from '../lib/pennycore-oauth-demo.js'
const owner='11111111-1111-4111-8111-111111111111', other='22222222-2222-4222-8222-222222222222'
const callback='https://oauth-redirect-test.googleusercontent.com/r/synthetic-test-app'
const env={VERCEL_ENV:'production',PENNYCORE_MCP_DEMO_ENABLED:'1',PENNYCORE_MCP_DEMO_DB_URL:'synthetic-only',PENNYCORE_MCP_DEMO_REDIRECT_URIS:callback,PENNYCORE_OWNER_ACCOUNT_ID:owner}
const verifier='a'.repeat(43), challenge=createHash('sha256').update(verifier).digest('base64url')
function fixture(overrides={}){
 const rows=[],calls=[],clients=[]
 const store={
  async register(p){calls.push('register');if(clients.length>=64)return null;clients.push({client_id:p.id,account:p.account,redirect_uris:p.redirects,auth_method:p.method,secret_hash:p.secretHash});return {issued:1,expires:2592001}},
  async client(p){calls.push('client');return clients.find(c=>c.client_id===p.id&&c.account===p.account&&!c.expired)||null},
  async begin(p){calls.push('begin');rows.push({...p,used:false,revoked:false})},
  async decide(p){calls.push('decide');const r=rows.find(r=>r.nonceHash===p.nonceHash&&r.account===p.account&&!r.used&&!r.revoked&&!r.expired);if(!r)return null;r.used=true;r.codeHash=p.codeHash;return {redirect_uri:r.redirect,oauth_state:r.state}},
  async exchange(p){calls.push('exchange');const r=rows.find(r=>['codeHash','account','client','redirect','challenge','resource','scope'].every(k=>r[k]===p[k])&&r.used&&!r.tokenHash&&!r.revoked&&!r.expired);if(!r)return false;r.tokenHash=p.tokenHash;return true},
  async verify(p){calls.push('verify');return rows.some(r=>['tokenHash','account','resource','scope'].every(k=>r[k]===p[k])&&!r.revoked&&!r.expired&&p.redirects.includes(r.redirect)&&clients.some(c=>c.client_id===r.client&&!c.expired))},
  async revoke(p){for(const r of rows)if(r.tokenHash===p.tokenHash&&r.account===p.account&&r.client===p.client)r.revoked=true},
  async revokeAll(a){for(const r of rows)if(r.account===a)r.revoked=true}
 }
 const handler=createOAuthDemoHandler({currentAccount:async req=>req.account?{id:req.account}:null,store,env:{...env,...overrides}})
 async function req(action,options={}){
  const headers={},res={setHeader(k,v){headers[k]=v},status(code){this.code=code;return this},json(body){this.body=body;return this},send(body){this.body=body;return this},end(){return this}}
  await handler({method:'GET',query:{action},headers:{},...options},res)
  return {code:res.code,body:res.body,headers}
 }
 const reg=(data={})=>req('register',{method:'POST',headers:{'content-type':'application/json'},body:{redirect_uris:[callback],token_endpoint_auth_method:'client_secret_post',grant_types:['authorization_code','refresh_token'],response_types:['code'],...data}})
 const authQuery=c=>({action:'authorize',client_id:c.client_id,redirect_uri:callback,response_type:'code',scope:SCOPE,state:'synthetic-state',code_challenge:challenge,code_challenge_method:'S256',resource:RESOURCE})
 const form=(body,account,origin=ORIGIN,extra={})=>({method:'POST',headers:{origin,'content-type':'application/x-www-form-urlencoded',...extra},body,account})
 async function consent(c){
  const a=await req('authorize',{query:authQuery(c),account:owner});assert.equal(a.code,200)
  const nonce=/name="nonce" value="([^"]+)"/.exec(a.body)[1]
  const r=await req('authorize',form({nonce,decision:'allow'},owner));assert.equal(r.code,303)
  return {nonce,code:new URL(r.headers.Location).searchParams.get('code')}
 }
 const tokenForm=(c,code)=>({grant_type:'authorization_code',...(c.token_endpoint_auth_method!=='client_secret_basic'?{client_id:c.client_id,...(c.client_secret?{client_secret:c.client_secret}:{})}:{}),code,redirect_uri:callback,code_verifier:verifier,resource:RESOURCE})
 const basic=c=>({authorization:'Basic '+Buffer.from(c.client_id+':'+c.client_secret).toString('base64')})
 async function rpc(token,method='tools/call',params={name:'get_authorized_demo_megaseed',arguments:{}}){return req('mcp',{method:'POST',headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},body:{jsonrpc:'2.0',id:1,method,params}})}
 return {req,reg,rows,calls,clients,authQuery,form,consent,tokenForm,basic,rpc}
}
test('disabled discovery only and exact redirect configuration',async()=>{
 for(const uri of ['https://evil.example/r/app','https://oauth-redirect.googleusercontent.com/r/*','https://oauth-redirect.googleusercontent.com/r/test?x=1'])assert.equal(config({...env,PENNYCORE_MCP_DEMO_REDIRECT_URIS:uri}),null)
 assert.equal(config({...env,NEXUS_MEMORY_DATABASE_URL:env.PENNYCORE_MCP_DEMO_DB_URL}),null)
 assert.equal(config({...env,DATABASE_URL:env.PENNYCORE_MCP_DEMO_DB_URL}),null)
 const f=fixture({PENNYCORE_MCP_DEMO_ENABLED:'0'})
 assert.equal((await f.req('metadata')).body.registration_endpoint,RESOURCE+'/register')
 assert.equal((await f.req('resource')).body.resource,RESOURCE)
 assert.equal((await f.reg()).code,503);assert.equal((await f.rpc(null)).code,401);assert.equal(f.calls.length,0)
 const preview=fixture({VERCEL_ENV:'preview'});assert.equal((await preview.req('metadata')).code,503)
})
test('DCR exact callback, restricted scope, bounded registration, no consent or secret persistence',async()=>{
 const f=fixture()
 for(const change of [{redirect_uris:['https://oauth-redirect-test.googleusercontent.com/r/another-app']},{scope:'memory.write'},{grant_types:['client_credentials']},{token_endpoint_auth_method:'private_key_jwt'},{response_types:['token']}])assert.equal((await f.reg(change)).code,400)
 assert.equal(f.clients.length,0)
 const r=await f.reg();assert.equal(r.code,201);assert.match(r.body.client_id,/^pcdemo_/);assert.equal(r.body.client_secret.length,43);assert.deepEqual(r.body.grant_types,['authorization_code'])
 assert.ok(!JSON.stringify(f.clients).includes(r.body.client_secret));assert.equal(f.rows.length,0)
 for(let i=1;i<64;i++)assert.equal((await f.reg()).code,201)
 assert.equal((await f.reg()).code,429)
})
test('Owner consent, PKCE, exact client, one-time exchange, token revocation',async()=>{
 const f=fixture(),c=(await f.reg()).body,otherClient=(await f.reg()).body
 for(const change of [{redirect_uri:'https://evil.example'},{scope:'memory.write'},{resource:'https://evil.example'},{code_challenge_method:'plain'},{client_id:'unregistered'}])assert.equal((await f.req('authorize',{query:{...f.authQuery(c),...change},account:owner})).code,400)
 assert.equal((await f.req('authorize',{query:f.authQuery(c),account:other})).code,401)
 const {nonce,code}=await f.consent(c)
 assert.equal((await f.req('authorize',f.form({nonce,decision:'allow'},owner))).code,400)
 assert.equal((await f.rpc(null)).code,401)
 assert.equal((await f.req('mcp',{method:'POST',account:owner,headers:{'content-type':'application/json'},body:{jsonrpc:'2.0',id:1,method:'ping'}})).code,401)
 for(const change of [{code_verifier:'b'.repeat(43)},{client_secret:'b'.repeat(43)},{client_id:otherClient.client_id,client_secret:otherClient.client_secret},{resource:'https://evil.example'}])assert.equal((await f.req('token',f.form({...f.tokenForm(c,code),...change}))).code,400)
 const attempts=await Promise.all([f.req('token',f.form(f.tokenForm(c,code))),f.req('token',f.form(f.tokenForm(c,code)))])
 assert.deepEqual(attempts.map(r=>r.code).sort(),[200,400])
 const token=attempts.find(r=>r.code===200).body.access_token
 assert.ok(!JSON.stringify(f.rows).includes(token));assert.ok(!JSON.stringify(f.rows).includes(code));assert.ok(!JSON.stringify(f.rows).includes(nonce))
 assert.match((await f.rpc(token)).body.result.content[0].text,/VELVET-COMET-83/)
 assert.equal((await f.rpc(token,'tools/call',{name:'get_real_memory',arguments:{}})).body.error.code,-32602)
 assert.equal((await f.rpc(token,'tools/call',{name:'save_megaseed',arguments:{}})).body.error.code,-32602)
 assert.equal((await f.req('revoke',f.form({token,client_id:c.client_id,client_secret:c.client_secret}))).code,200)
 assert.equal((await f.rpc(token)).code,401)
})
test('Basic and public clients, expiration, CSRF and disconnect',async()=>{
 const f=fixture()
 for(const method of ['client_secret_basic','none']){
  const c=(await f.reg({token_endpoint_auth_method:method})).body
  const {code}=await f.consent(c)
  const t=await f.req('token',f.form(f.tokenForm(c,code),null,ORIGIN,method==='client_secret_basic'?f.basic(c):{}));assert.equal(t.code,200)
  const token=t.body.access_token
  assert.equal((await f.req('disconnect',f.form({confirm:'revoke'},other))).code,403)
  assert.equal((await f.req('disconnect',f.form({confirm:'revoke'},owner,'https://evil.example'))).code,403)
  assert.equal((await f.req('disconnect',f.form({confirm:'revoke'},owner))).code,200)
  assert.equal((await f.rpc(token)).code,401)
 }
 const c=(await f.reg()).body,{code}=await f.consent(c);f.rows.at(-1).expired=true
 assert.equal((await f.req('token',f.form(f.tokenForm(c,code)))).code,400)
})

test('Gemini long opaque OAuth state is accepted and echoed exactly, oversized state rejected',async()=>{
 const f=fixture(),c=(await f.reg()).body
 const state='s'.repeat(1111)
 const a=await f.req('authorize',{query:{...f.authQuery(c),state},account:owner});assert.equal(a.code,200)
 const nonce=/name="nonce" value="([^"]+)"/.exec(a.body)[1]
 const r=await f.req('authorize',f.form({nonce,decision:'allow'},owner));assert.equal(r.code,303)
 assert.equal(new URL(r.headers.Location).searchParams.get('state'),state)
 assert.equal((await f.req('authorize',{query:{...f.authQuery(c),state:'s'.repeat(4097)},account:owner})).code,400)
})
