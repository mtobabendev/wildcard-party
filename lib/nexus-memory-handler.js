import { isOwner, configuredForRead } from './penny-owner.js'
import { memoryReady, memoryKey, parsePacket, encryptPacket, decryptPacket, cursorValid, PAGE_SIZE } from './nexus-memory-state.js'

const ORIGIN='https://party.wildcarddev.com'
export function createNexusMemoryHandler({currentAccount,sameOrigin,store,env=process.env}) {
  return async (req,res)=>{
    res.setHeader('Cache-Control','private, no-store')
    res.setHeader('X-Content-Type-Options','nosniff')
    res.setHeader('Cross-Origin-Resource-Policy','same-origin')
    res.setHeader('X-Robots-Tag','noindex, nofollow')
    if(!['GET','POST'].includes(req.method)){res.setHeader('Allow','GET, POST');return res.status(405).json({error:'Method not allowed.'})}
    if(!sameOrigin(req)||(req.method==='POST'&&req.headers?.origin!==ORIGIN))return res.status(403).json({error:'Origin check failed.'})
    try{
      const account=await currentAccount(req)
      if(!account)return res.status(401).json({error:'Sign in required.'})
      if(!isOwner(account,env))return res.status(403).json({error:'Owner authorization required.'})
      const query=req.query||{}, ready=memoryReady(env)
      if(req.method==='GET'&&query.view==='status'&&Object.keys(query).length===1)return res.status(200).json({owner:true,memoryReady:ready,projectReady:configuredForRead(env)})
      if(!ready)return res.status(503).json({error:'Encrypted memory storage is not activated.'})
      const key=memoryKey(env)
      const expose=row=>({id:row.id,createdAt:row.created_at,...decryptPacket(row.envelope,account.id,row.request_id,key)})
      if(req.method==='GET'){
        if(query.view!=='records'||Object.keys(query).some(k=>!['view','before'].includes(k))||(query.before!==undefined&&!cursorValid(query.before)))return res.status(400).json({error:'Invalid memory query.'})
        const rows=await store.list(account.id,query.before)
        if(!Array.isArray(rows)||rows.length>PAGE_SIZE+1)throw Error('Invalid memory response.')
        const records=rows.slice(0,PAGE_SIZE).map(expose)
        return res.status(200).json({records,nextBefore:rows.length>PAGE_SIZE?records.at(-1).id:null})
      }
      if(Object.keys(query).length||!/^application\/json(?:;|$)/i.test(req.headers?.['content-type']||''))return res.status(415).json({error:'JSON capture required.'})
      let packet
      try{packet=parsePacket(typeof req.body==='string'?JSON.parse(req.body):req.body)}catch{return res.status(400).json({error:'Invalid capture. Check field limits and remove credentials.'})}
      const result=await store.append(account.id,packet.requestId,encryptPacket(packet,account.id,key))
      const saved=expose(result.row)
      const {id,createdAt,...existing}=saved
      if(JSON.stringify(existing)!==JSON.stringify(packet))return res.status(409).json({error:'Capture ID already belongs to different content.'})
      return res.status(result.duplicate?200:201).json({record:saved,duplicate:result.duplicate})
    }catch{return res.status(503).json({error:'Private workspace memory is unavailable.'})}
  }
}
