import {createHmac,timingSafeEqual} from 'node:crypto'
import {memoryKey,memoryReady} from './nexus-memory-state.js'
import {isOwner} from './penny-owner.js'
import {createNexusMemoryHandler} from './nexus-memory-handler.js'
const ORIGIN='https://party.wildcarddev.com',AUD='nexus-journal-device-v1',DAY=86400
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
const deviceId=v=>uuid(v)&&v[14]==='4'&&/[89ab]/i.test(v[19])
const signer=(key,p)=>createHmac('sha256',createHmac('sha256',key).update(AUD).digest()).update(p).digest()
export function issueGrant(session,id,env,now=Math.floor(Date.now()/1000)){
 const key=memoryKey(env)
 if(!memoryReady(env)||!key||!deviceId(id)||!uuid(session?.id)||!isOwner({id:session?.account},env)||!Number.isSafeInteger(session.expires)||session.expires<=now)throw Error('Invalid device enrollment.')
 const claims={aud:AUD,sub:session.account.toLowerCase(),sid:session.id.toLowerCase(),device:id.toLowerCase(),iat:now,exp:Math.min(session.expires,now+30*DAY)}
 const p=Buffer.from(JSON.stringify(claims)).toString('base64url')
 return {grant:p+'.'+signer(key,p).toString('base64url'),expires:claims.exp}
}
export function verifyGrant(value,env,now=Math.floor(Date.now()/1000)){
 const key=memoryKey(env)
 if(!memoryReady(env)||!key||typeof value!=='string'||value.length>1024)return null
 const parts=value.split('.');if(parts.length!==2||!parts.every(p=>/^[A-Za-z0-9_-]+$/.test(p)))return null
 const [p,s]=parts,b=Buffer.from(s,'base64url'),expected=signer(key,p)
 if(b.length!==expected.length||b.toString('base64url')!==s||!timingSafeEqual(b,expected))return null
 try{const c=JSON.parse(Buffer.from(p,'base64url').toString('utf8'));if(Object.keys(c).length!==6||c.aud!==AUD||!isOwner({id:c.sub},env)||!uuid(c.sid)||!deviceId(c.device)||!Number.isSafeInteger(c.iat)||!Number.isSafeInteger(c.exp)||c.iat>now||c.exp<=now||c.exp-c.iat>30*DAY)return null;return c}catch{return null}
}
export function createDeviceHandler({currentDeviceSession,liveDeviceSession,store,env=process.env}){
 const currentAccount=async req=>{const match=/^Bearer ([A-Za-z0-9_.-]+)$/.exec(req.headers?.authorization||'');const c=match&&verifyGrant(match[1],env);if(!c)return null;return liveDeviceSession(c.sid,c.sub)}
 const journal=createNexusMemoryHandler({currentAccount,sameOrigin:()=>false,store,env,device:true})
 return async(req,res)=>{
  res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Robots-Tag','noindex, nofollow');res.setHeader('Cross-Origin-Resource-Policy','same-origin')
  if(req.query?.action==='pair'){
   if(req.method!=='POST'||Object.keys(req.query).length!==1||req.headers?.origin!==ORIGIN||req.headers?.authorization!==undefined||!/^application\/json(?:;|$)/i.test(req.headers?.['content-type']||''))return res.status(403).json({error:'Owner enrollment required.'})
   try{
    const body=typeof req.body==='string'?JSON.parse(req.body):req.body
    if(!body||Object.keys(body).length!==2||body.approved!==true||!deviceId(body.deviceId))return res.status(400).json({error:'Explicit device approval required.'})
    const session=await currentDeviceSession(req);if(!session||!isOwner({id:session.account},env))return res.status(403).json({error:'Owner enrollment required.'})
    if(!memoryReady(env))return res.status(503).json({error:'Memory unavailable.'})
    return res.status(201).json(issueGrant(session,body.deviceId,env))
   }catch{return res.status(503).json({error:'Device enrollment unavailable.'})}
  }
  // No cookie authority or browser-origin API calls; only the scoped bearer is accepted.
  return journal(req,res)
 }
}
