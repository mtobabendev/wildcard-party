import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createOAuthDemoHandler,config,ORIGIN,RESOURCE,CLIENT,SCOPE } from '../lib/pennycore-oauth-demo.js'
const owner='11111111-1111-4111-8111-111111111111', other='22222222-2222-4222-8222-222222222222'
const callback='https://oauth-redirect-test.googleusercontent.com/r/synthetic-test-app'
const env={VERCEL_ENV:'production',PENNYCORE_MCP_DEMO_ENABLED:'1',PENNYCORE_MCP_DEMO_DB_URL:'synthetic-only',PENNYCORE_MCP_DEMO_REDIRECT_URIS:callback,PENNYCORE_OWNER_ACCOUNT_ID:owner}
const verifier='a'.repeat(43), challenge=createHash('sha256').update(verifier).digest('base64url')
function fixture(overrides={}){
 const rows=[],calls=[]
 const store={
  async begin(p){calls.push('begin');rows.push({...p,used:false,revoked:false})},
  async decide(p){calls.push('decide');const r=rows.find(r=>r.nonceHash===p.nonceHash&&r.account===p.account&&!r.used&&!r.revoked&&!r.expired);if(!r)return null;r.used=true;r.codeHash=p.codeHash;return {redirect_uri:r.redirect,oauth_state:r.state}},
  async exchange(p){calls.push('exchange');const r=rows.find(r=>['codeHash','account','client','redirect','challenge','resource','scope'].every(k=>r[k]===p[k])&&r.used&&!r.tokenHash&&!r.revoked&&!r.expired);if(!r)return false;r.tokenHash=p.tokenHash;return true},
  async verify(p){calls.push('verify');return rows.some(r=>['tokenHash','account','client','resource','scope'].every(k=>r[k]===p[k])&&!r.revoked&&!r.expired)},
  async revoke(p){for(const r of rows)if(r.tokenHash===p.tokenHash&&r.account===p.account&&r.client===p.client)r.revoked=true},
  async revokeAll(a){for(const r of rows)if(r.account===a)r.revoked=true}
 }
 const handler=createOAuthDemoHandler({currentAccount:async req=>req.account?{id:req.account}:null,store,env:{...env,...overrides}})
 async function req(action,options={}){
  const headers={},res={setHeader(k,v){headers[k]=v},status(code){this.code=code;return this},json(body){this.body=body;return this},send(body){this.body=body;return this},end(){return this}}
  await handler({method:'GET',query:{action},headers:{},...options},res)
  return {code:res.code,body:res.body,headers}
 }
 const authQuery={action:'authorize',client_id:CLIENT,redirect_uri:callback,response_type:'code',scope:SCOPE,state:'synthetic-state',code_challenge:challenge,code_challenge_method:'S256',resource:RESOURCE}
 const form=(body,account,origin=ORIGIN)=>({method:'POST',headers:{origin,'content-type':'application/x-www-form-urlencoded'},body,account})
 async function consent(){
  const a=await req('authorize',{query:authQuery,account:owner});assert.equal(a.code,200)
  const nonce=/name="nonce" value="([^"]+)"/.exec(a.body)[1]
  const r=await req('authorize',form({nonce,decision:'allow'},owner));assert.equal(r.code,303)
  return {nonce,code:new URL(r.headers.Location).searchParams.get('code')}
 }
 const tokenForm=code=>({grant_type:'authorization_code',client_id:CLIENT,code,redirect_uri:callback,code_verifier:verifier,resource:RESOURCE})
 async function rpc(token,method='tools/call',params={name:'get_authorized_demo_megaseed',arguments:{}}){return req('mcp',{method:'POST',headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},body:{jsonrpc:'2.0',id:1,method,params}})}
 return {req,rows,calls,authQuery,form,consent,tokenForm,rpc}
}
test('disabled by default and exact Google redirect allowlist',async()=>{
 assert.equal(config({...env,PENNYCORE_MCP_DEMO_ENABLED:'0'}),null)
 for(const uri of ['https://evil.example/r/app','https://oauth-redirect.googleusercontent.com/r/*','https://oauth-redirect.googleusercontent.com/r/test?x=1','https://oauth-redirect.googleusercontent.com.evil.example/r/app'])assert.equal(config({...env,PENNYCORE_MCP_DEMO_REDIRECT_URIS:uri}),null)
 const f=fixture({VERCEL_ENV:'preview'});assert.equal((await f.req('metadata')).code,503);assert.equal(f.calls.length,0)
})
test('metadata and authorization reject wrong owner, callback, scope, resource and CSRF origin',async()=>{
 const f=fixture()
 const m=await f.req('metadata');assert.equal(m.body.issuer,RESOURCE);assert.deepEqual(m.body.code_challenge_methods_supported,['S256'])
 assert.equal((await f.req('resource')).body.resource,RESOURCE)
 for(const change of [{redirect_uri:'https://oauth-redirect-test.googleusercontent.com/r/another-app'},{scope:'memory.write'},{resource:'https://evil.example'},{code_challenge_method:'plain'}])assert.equal((await f.req('authorize',{query:{...f.authQuery,...change},account:owner})).code,400)
 assert.equal((await f.req('authorize',{query:f.authQuery,account:other})).code,401)
 assert.equal(f.rows.length,0)
 const a=await f.req('authorize',{query:f.authQuery,account:owner});const nonce=/name="nonce" value="([^"]+)"/.exec(a.body)[1]
 assert.equal((await f.req('authorize',f.form({nonce,decision:'allow'},owner,'https://evil.example'))).code,403)
 assert.equal((await f.req('authorize',f.form({nonce,decision:'allow'},other))).code,403)
 assert.equal((await f.req('authorize',f.form({nonce,decision:'deny'},owner))).code,303)
 assert.equal((await f.req('authorize',f.form({nonce,decision:'allow'},owner))).code,400)
})
test('PKCE binding, one-time grant, hashed credentials, revocation and bearer-only synthetic access',async()=>{
 const f=fixture(),{nonce,code}=await f.consent()
 assert.equal((await f.req('authorize',f.form({nonce,decision:'allow'},owner))).code,400)
 assert.equal((await f.rpc(null)).code,401)
 assert.equal((await f.req('mcp',{method:'POST',account:owner,headers:{'content-type':'application/json'},body:{jsonrpc:'2.0',id:1,method:'ping'}})).code,401)
 for(const change of [{code_verifier:'b'.repeat(43)},{redirect_uri:'https://oauth-redirect-test.googleusercontent.com/r/other'},{resource:'https://evil.example'},{client_id:'another'}])assert.equal((await f.req('token',f.form({...f.tokenForm(code),...change}))).code,400)
 const t=await f.req('token',f.form(f.tokenForm(code)));assert.equal(t.code,200);const token=t.body.access_token
 assert.equal(t.body.expires_in,900);assert.equal(t.body.refresh_token,undefined)
 assert.ok(!JSON.stringify(f.rows).includes(code));assert.ok(!JSON.stringify(f.rows).includes(token));assert.ok(!JSON.stringify(f.rows).includes(nonce))
 assert.equal((await f.req('token',f.form(f.tokenForm(code)))).code,400)
 const r=await f.rpc(token);assert.equal(r.code,200);assert.match(r.body.result.content[0].text,/VELVET-COMET-83/)
 assert.equal((await f.rpc(token,'tools/call',{name:'get_real_memory',arguments:{}})).body.error.code,-32602)
 assert.equal((await f.rpc(token,'tools/call',{name:'save_megaseed',arguments:{}})).body.error.code,-32602)
 assert.equal((await f.req('revoke',f.form({token,client_id:CLIENT}))).code,200)
 assert.equal((await f.rpc(token)).code,401)
})
test('expired and owner-disconnected grants cannot be used',async()=>{
 const f=fixture(),{code}=await f.consent()
 f.rows[0].expired=true
 assert.equal((await f.req('token',f.form(f.tokenForm(code)))).code,400)
 const x=await f.consent(),t=await f.req('token',f.form(f.tokenForm(x.code)));assert.equal(t.code,200)
 assert.equal((await f.req('disconnect',f.form({confirm:'revoke'},other))).code,403)
 assert.equal((await f.req('disconnect',f.form({confirm:'revoke'},owner))).code,200)
 assert.equal((await f.rpc(t.body.access_token)).code,401)
})

test('production discovery before activation is public metadata only; no consent or storage',async()=>{
 const f=fixture({PENNYCORE_MCP_DEMO_ENABLED:'0'})
 const resource=await f.req('resource');assert.equal(resource.code,200);assert.equal(resource.body.resource,RESOURCE)
 const metadata=await f.req('metadata');assert.equal(metadata.code,200);assert.equal(metadata.body.issuer,RESOURCE)
 const r=await f.rpc('a'.repeat(43));assert.equal(r.code,401);assert.match(r.headers['WWW-Authenticate'],/resource_metadata/)
 assert.equal((await f.req('authorize',{query:f.authQuery,account:owner})).code,503)
 assert.equal((await f.req('token',f.form(f.tokenForm('a'.repeat(43))))).code,503)
 assert.equal(f.calls.length,0);assert.equal(f.rows.length,0)
 assert.equal(config({...env,NEXUS_MEMORY_DATABASE_URL:env.PENNYCORE_MCP_DEMO_DB_URL}),null)
 assert.equal(config({...env,DATABASE_URL:env.PENNYCORE_MCP_DEMO_DB_URL}),null)
})
