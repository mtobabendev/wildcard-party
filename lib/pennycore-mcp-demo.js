// PUBLIC synthetic interoperability fixture. Deliberately imports nothing.
// Never add real records, environment reads, credentials, database or network access.
// A private OAuth-backed resource must use a DIFFERENT endpoint and security review.
const VERSIONS=new Set(['2025-03-26','2025-06-18','2025-11-25'])
const VERSION='2025-11-25'
const SERVER={name:'pennycore-demo',title:'PennyCore Demo',version:'1.0.0'}
const DEMO=Object.freeze({
 title:'Fictional Lantern Observatory checkpoint',
 state:'SYNTHETIC DEMO ONLY. Observatory readiness code is LANTERN-ORBIT-47.',
 context:'A fictional observatory uses a copper telescope and a cobalt star chart. No real Owner, account, or project data.',
 memory:'The fictional team selected the copper telescope. This packet is a public interoperability fixture, not an actual memory.',
 nextStep:'Report the readiness code and identify the selected telescope; do not execute any actions.'
})
const TOOL=Object.freeze({
 name:'get_demo_megaseed',
 title:'Get fictional PennyCore checkpoint',
 description:'Retrieve the fixed public fictional Lantern Observatory MegaSeed to test read-only interoperability. No real memory, account data, or writes. Do not send chat content or credentials as arguments.',
 inputSchema:{type:'object',properties:{},additionalProperties:false},
 annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false}
})
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)
const has=(v,k)=>Object.prototype.hasOwnProperty.call(v,k)
const rpcError=(id,code,message)=>({jsonrpc:'2.0',id,error:{code,message}})
const rpcResult=(id,result)=>({jsonrpc:'2.0',id,result})
const resultText=value=>({content:[{type:'text',text:JSON.stringify(value)}]})
export function createDemoMcpHandler(){
 return (req,res)=>{
  res.setHeader('Cache-Control','no-store')
  res.setHeader('X-Content-Type-Options','nosniff')
  res.setHeader('X-Robots-Tag','noindex, nofollow')
  res.setHeader('Cross-Origin-Resource-Policy','same-origin')
  const headers=req.headers||{}
  // Backend MCP calls have no browser Origin. Do not accept arbitrary web origins.
  if(headers.origin&&headers.origin!=='https://party.wildcarddev.com')return res.status(403).json({error:'Origin denied.'})
  if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({error:'POST only; no SSE stream.'})}
  if(Object.keys(req.query||{}).length)return res.status(400).json({error:'Query parameters are not supported.'})
  if(!/^application\/json(?:;|$)/i.test(headers['content-type']||''))return res.status(415).json({error:'JSON required.'})
  if(headers.accept&&!headers.accept.toLowerCase().includes('application/json')&&!headers.accept.includes('*/*'))return res.status(406).json({error:'Accept application/json.'})
  if(headers['mcp-protocol-version']&&!VERSIONS.has(headers['mcp-protocol-version']))return res.status(400).json({error:'Unsupported MCP protocol version.'})
  let body
  try{
   const raw=typeof req.body==='string'?req.body:JSON.stringify(req.body)
   if(!raw||Buffer.byteLength(raw,'utf8')>8192)return res.status(413).json({error:'Request too large.'})
   body=JSON.parse(raw)
  }catch{return res.status(400).json(rpcError(null,-32700,'Parse error.'))}
  if(!object(body)||body.jsonrpc!=='2.0'||typeof body.method!=='string'||(has(body,'params')&&!object(body.params))||(has(body,'id')&&!(typeof body.id==='string'||typeof body.id==='number'&&Number.isFinite(body.id))))return res.status(400).json(rpcError(null,-32600,'Invalid request.'))
  if(!has(body,'id'))return res.status(202).end()
  const id=body.id, params=body.params||{}
  const ok=value=>res.status(200).json(rpcResult(id,value))
  const fail=(code,message)=>res.status(200).json(rpcError(id,code,message))
  switch(body.method){
   case 'initialize':
    if(typeof params.protocolVersion!=='string'||!object(params.capabilities)||!object(params.clientInfo)||typeof params.clientInfo.name!=='string'||typeof params.clientInfo.version!=='string')return fail(-32602,'Invalid initialize parameters.')
    return ok({protocolVersion:VERSIONS.has(params.protocolVersion)?params.protocolVersion:VERSION,capabilities:{tools:{}},serverInfo:SERVER,instructions:'Public fictional demonstration only. Retrieve a synthetic MegaSeed to test protocol compatibility. No actual PennyCore records or write capabilities.'})
   case 'ping':return ok({})
   case 'tools/list':
    if(has(params,'cursor'))return fail(-32602,'No pagination.')
    return ok({tools:[TOOL]})
   case 'tools/call':
    if(params.name!==TOOL.name)return fail(-32602,'Unknown tool. Only the synthetic read tool is available.')
    if(has(params,'arguments')&&(!object(params.arguments)||Object.keys(params.arguments).length))return ok({...resultText({error:'No arguments accepted. Do not send private information.'}),isError:true})
    return ok(resultText({synthetic:true,readOnly:true,packet:DEMO}))
   default:return fail(-32601,'Method not found.')
  }
 }
}
