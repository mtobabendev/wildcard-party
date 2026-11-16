import { createHash, randomBytes } from 'node:crypto'
import { isOwner } from './penny-owner.js'

export const ORIGIN='https://party.wildcarddev.com'
export const RESOURCE=ORIGIN+'/api/pennycore-auth-demo'
export const ISSUER=RESOURCE
export const CLIENT='pennycore-gemini-demo-v1'
export const SCOPE='pennycore.demo.read'
export const RESOURCE_METADATA=ORIGIN+'/.well-known/oauth-protected-resource/api/pennycore-auth-demo'
export const SERVER_METADATA=ORIGIN+'/.well-known/oauth-authorization-server/api/pennycore-auth-demo'
const GOOGLE_HOSTS=new Set(['oauth-redirect.googleusercontent.com','oauth-redirect-sandbox.googleusercontent.com','oauth-redirect-test.googleusercontent.com'])
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TOKEN=/^[A-Za-z0-9_-]{43}$/
const VERIFIER=/^[A-Za-z0-9._~-]{43,128}$/
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)
const hash=x=>createHash('sha256').update(x).digest('hex')
const challenge=x=>createHash('sha256').update(x).digest('base64url')
const random=()=>randomBytes(32).toString('base64url')
const versions=new Set(['2025-03-26','2025-06-18','2025-11-25'])
const allowedRedirect=value=>{
 try{
  const u=new URL(value)
  return u.protocol==='https:'&&GOOGLE_HOSTS.has(u.hostname)&&!u.port&&!u.username&&!u.password&&!u.search&&!u.hash&&/^\/(?:r|a)\/[A-Za-z0-9._~-]{1,512}$/.test(u.pathname)&&u.href===value
 }catch{return false}
}
export function config(env){
 const redirects=typeof env.PENNYCORE_MCP_DEMO_REDIRECT_URIS==='string'?env.PENNYCORE_MCP_DEMO_REDIRECT_URIS.split(',').map(s=>s.trim()).filter(Boolean):[]
 if(env.VERCEL_ENV!=='production'||env.PENNYCORE_MCP_DEMO_ENABLED!=='1'||!env.PENNYCORE_MCP_DEMO_DB_URL||!UUID.test(env.PENNYCORE_OWNER_ACCOUNT_ID||'')||env.PENNYCORE_MCP_DEMO_DB_URL===env.NEXUS_MEMORY_DATABASE_URL||env.PENNYCORE_MCP_DEMO_DB_URL===env.DATABASE_URL||!redirects.length||redirects.length>6||!redirects.every(allowedRedirect)||new Set(redirects).size!==redirects.length)return null
 return {redirects,ownerId:env.PENNYCORE_OWNER_ACCOUNT_ID.toLowerCase()}
}
function input(body){
 if(typeof body==='string'){
  if(Buffer.byteLength(body,'utf8')>8192)throw Error('Invalid form.')
  const p=new URLSearchParams(body), out={}
  for(const [k,v] of p){if(Object.hasOwn(out,k)||['__proto__','constructor','prototype'].includes(k))throw Error('Invalid form.');out[k]=v}
  return out
 }
 if(!object(body)||Buffer.byteLength(JSON.stringify(body),'utf8')>8192||Object.values(body).some(v=>typeof v!=='string'))throw Error('Invalid form.')
 return body
}
const exact=(p,allowed)=>Object.keys(p).every(k=>allowed.includes(k))
const escapeHtml=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
const html=(res,status,title,content)=>{
 res.setHeader('Content-Type','text/html; charset=utf-8')
 res.setHeader('Content-Security-Policy',"default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'")
 return res.status(status).send('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+escapeHtml(title)+'</title><main><h1>'+escapeHtml(title)+'</h1>'+content+'</main></html>')
}
const redirect=(res,uri,params)=>{
 const target=new URL(uri)
 for(const [k,v] of Object.entries(params))target.searchParams.set(k,v)
 res.setHeader('Location',target.href)
 return res.status(303).end()
}
const oauthError=(res,status,error)=>res.status(status).json({error})
const bearerError=res=>{
 res.setHeader('WWW-Authenticate','Bearer resource_metadata="'+RESOURCE_METADATA+'", scope="'+SCOPE+'"')
 return oauthError(res,401,'invalid_token')
}
const metadata=()=>({issuer:ISSUER,authorization_endpoint:RESOURCE+'/authorize',token_endpoint:RESOURCE+'/token',revocation_endpoint:RESOURCE+'/revoke',response_types_supported:['code'],response_modes_supported:['query'],grant_types_supported:['authorization_code'],code_challenge_methods_supported:['S256'],token_endpoint_auth_methods_supported:['none'],revocation_endpoint_auth_methods_supported:['none'],scopes_supported:[SCOPE]})
const tool={name:'get_authorized_demo_megaseed',description:'Read a fictional authenticated interoperability checkpoint. No actual private memory. No arguments or writes.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false}}
const packet={title:'Authenticated fictional observatory',state:'SYNTHETIC ONLY. Readiness code: VELVET-COMET-83.',context:'Fictional telescope array. This is not a real Owner record.',memory:'The imaginary team selected an amber lens.',nextStep:'Report the code and lens. Do not take actions.'}
function rpc(req,res){
 if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).end()}
 if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))return oauthError(res,415,'invalid_request')
 if(req.headers.accept&&!req.headers.accept.includes('application/json')&&!req.headers.accept.includes('*/*'))return oauthError(res,406,'invalid_request')
 if(req.headers['mcp-protocol-version']&&!versions.has(req.headers['mcp-protocol-version']))return oauthError(res,400,'invalid_request')
 let p
 try{const s=typeof req.body==='string'?req.body:JSON.stringify(req.body);if(!s||Buffer.byteLength(s)>8192)throw Error();p=JSON.parse(s)}catch{return oauthError(res,400,'invalid_request')}
 if(!object(p)||p.jsonrpc!=='2.0'||typeof p.method!=='string'||(Object.hasOwn(p,'params')&&!object(p.params))||(Object.hasOwn(p,'id')&&!(typeof p.id==='string'||typeof p.id==='number'&&Number.isFinite(p.id))))return oauthError(res,400,'invalid_request')
 if(!Object.hasOwn(p,'id'))return res.status(202).end()
 const params=p.params||{},ok=result=>res.status(200).json({jsonrpc:'2.0',id:p.id,result}),err=(code,message)=>res.status(200).json({jsonrpc:'2.0',id:p.id,error:{code,message}})
 switch(p.method){
  case 'initialize':
   if(typeof params.protocolVersion!=='string'||!object(params.capabilities)||!object(params.clientInfo))return err(-32602,'Invalid parameters.')
   return ok({protocolVersion:versions.has(params.protocolVersion)?params.protocolVersion:'2025-11-25',capabilities:{tools:{}},serverInfo:{name:'pennycore-auth-demo',version:'1.0.0'},instructions:'Authenticated fictional fixture only. Do not send private data.'})
  case 'ping':return ok({})
  case 'tools/list':return Object.hasOwn(params,'cursor')?err(-32602,'No pagination.'):ok({tools:[tool]})
  case 'tools/call':
   if(params.name!==tool.name||(Object.hasOwn(params,'arguments')&&(!object(params.arguments)||Object.keys(params.arguments).length)))return err(-32602,'Only the fixed read tool without arguments is available.')
   return ok({content:[{type:'text',text:JSON.stringify({synthetic:true,readOnly:true,packet})}]})
  default:return err(-32601,'Method not found.')
 }
}
export function createOAuthDemoHandler({currentAccount,store,env=process.env}){
 return async(req,res)=>{
  res.setHeader('Cache-Control','private, no-store');res.setHeader('Pragma','no-cache');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Robots-Tag','noindex, nofollow');res.setHeader('X-Frame-Options','DENY')
  const cfg=config(env)
  const h=req.headers||{},q=req.query||{},route=q.action||'mcp'
  if(typeof route!=='string'||!['resource','metadata','authorize','token','revoke','disconnect','mcp'].includes(route))return oauthError(res,404,'invalid_request')
  if(h.origin&&h.origin!==ORIGIN)return oauthError(res,403,'invalid_request')
  if(route!=='authorize'&&!exact(q,['action']))return oauthError(res,400,'invalid_request')
  // Public protocol discovery is safe before linking; never consult the store in this state.
  if(env.VERCEL_ENV!=='production')return oauthError(res,503,'temporarily_unavailable')
  if(!cfg&&!['resource','metadata'].includes(route)){
   if(route==='mcp'&&req.method==='POST')return bearerError(res)
   if(route==='mcp'){res.setHeader('Allow','POST');return res.status(405).end()}
   return oauthError(res,503,'temporarily_unavailable')
  }
  const form=()=>{if(!/^application\/x-www-form-urlencoded(?:;|$)/i.test(h['content-type']||''))throw Error('Form required.');return input(req.body)}
  const owner=async()=>{const a=await currentAccount(req);return isOwner(a,env)?a:null}
  try{
   if(route==='resource'||route==='metadata'){
    if(req.method!=='GET')return oauthError(res,405,'invalid_request')
    return res.status(200).json(route==='resource'?{resource:RESOURCE,authorization_servers:[ISSUER],scopes_supported:[SCOPE],bearer_methods_supported:['header']}:metadata())
   }
   if(route==='authorize'){
    if(req.method==='GET'){
     const p=q
     if(!exact(p,['action','client_id','redirect_uri','response_type','scope','state','code_challenge','code_challenge_method','resource'])||p.client_id!==CLIENT||p.response_type!=='code'||!cfg.redirects.includes(p.redirect_uri)||p.code_challenge_method!=='S256'||!TOKEN.test(p.code_challenge||'')||typeof p.code_challenge!=='string'||typeof p.state!=='string'||!p.state||p.state.length>1024||(p.scope!==undefined&&p.scope!==SCOPE)||(p.resource!==undefined&&p.resource!==RESOURCE))return oauthError(res,400,'invalid_request')
     const a=await owner()
     if(!a)return html(res,401,'Owner sign-in required','<p>Sign in to your existing WildCard Owner workspace, then retry authorization in Gemini.</p><p><a href="/nexus.html" target="_blank" rel="noopener noreferrer">Open Owner workspace</a></p>')
     const nonce=random()
     await store.begin({nonceHash:hash(nonce),account:cfg.ownerId,client:CLIENT,redirect:p.redirect_uri,state:p.state,challenge:p.code_challenge,resource:RESOURCE,scope:SCOPE})
     return html(res,200,'Authorize Gemini synthetic demo','<p>Grant a short-lived, read-only connection to a fictional test packet. No private memory or real project records will be shared. Google may retain connected-app responses according to your activity settings.</p><form method="post" action="'+RESOURCE+'/authorize"><input type="hidden" name="nonce" value="'+escapeHtml(nonce)+'"><button name="decision" value="allow">Allow synthetic read for 15 minutes</button> <button name="decision" value="deny">Deny</button></form>')
    }
    if(req.method!=='POST')return oauthError(res,405,'invalid_request')
    if(h.origin!==ORIGIN||!exact(q,['action']))return oauthError(res,403,'invalid_request')
    if(!await owner())return oauthError(res,403,'access_denied')
    const p=form()
    if(!exact(p,['nonce','decision'])||!TOKEN.test(p.nonce||'')||!['allow','deny'].includes(p.decision))return oauthError(res,400,'invalid_request')
    const code=p.decision==='allow'?random():null
    const grant=await store.decide({nonceHash:hash(p.nonce),account:cfg.ownerId,codeHash:code?hash(code):null})
    if(!grant||!cfg.redirects.includes(grant.redirect_uri))return oauthError(res,400,'invalid_request')
    return redirect(res,grant.redirect_uri,code?{code,state:grant.oauth_state}:{error:'access_denied',state:grant.oauth_state})
   }
   if(route==='token'){
    if(req.method!=='POST')return oauthError(res,405,'invalid_request')
    const p=form()
    if(h.authorization||!exact(p,['grant_type','client_id','code','redirect_uri','code_verifier','resource'])||p.client_id!==CLIENT||p.grant_type!=='authorization_code'||!TOKEN.test(p.code||'')||!VERIFIER.test(p.code_verifier||'')||!cfg.redirects.includes(p.redirect_uri)||(p.resource!==undefined&&p.resource!==RESOURCE))return oauthError(res,400,'invalid_grant')
    const token=random()
    const granted=await store.exchange({codeHash:hash(p.code),account:cfg.ownerId,client:CLIENT,redirect:p.redirect_uri,challenge:challenge(p.code_verifier),resource:RESOURCE,scope:SCOPE,tokenHash:hash(token)})
    if(!granted)return oauthError(res,400,'invalid_grant')
    return res.status(200).json({access_token:token,token_type:'Bearer',expires_in:900,scope:SCOPE})
   }
   if(route==='revoke'){
    if(req.method!=='POST')return oauthError(res,405,'invalid_request')
    const p=form()
    if(h.authorization||!exact(p,['token','client_id','token_type_hint'])||p.client_id!==CLIENT||!TOKEN.test(p.token||'')||(p.token_type_hint!==undefined&&p.token_type_hint!=='access_token'))return oauthError(res,400,'invalid_request')
    await store.revoke({tokenHash:hash(p.token),account:cfg.ownerId,client:CLIENT})
    return res.status(200).end()
   }
   if(route==='disconnect'){
    if(!await owner())return oauthError(res,403,'access_denied')
    if(req.method==='GET')return html(res,200,'Disconnect synthetic Gemini access','<p>Revoke all outstanding demo grants and tokens. Your real memories are unaffected.</p><form method="post" action="'+RESOURCE+'/disconnect"><button name="confirm" value="revoke">Revoke all demo access</button></form>')
    if(req.method!=='POST'||h.origin!==ORIGIN)return oauthError(res,403,'invalid_request')
    const p=form();if(!exact(p,['confirm'])||p.confirm!=='revoke')return oauthError(res,400,'invalid_request')
    await store.revokeAll(cfg.ownerId)
    return html(res,200,'Demo access revoked','<p>All synthetic grants and tokens were invalidated.</p><p><a href="/nexus.html">Return to Nexus</a></p>')
   }
   if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).end()}
   const match=typeof h.authorization==='string'&&/^Bearer ([A-Za-z0-9_-]{43})$/.exec(h.authorization)
   if(!match)return bearerError(res)
   if(!await store.verify({tokenHash:hash(match[1]),account:cfg.ownerId,client:CLIENT,resource:RESOURCE,scope:SCOPE}))return bearerError(res)
   return rpc(req,res)
  }catch{return oauthError(res,503,'temporarily_unavailable')}
 }
}
