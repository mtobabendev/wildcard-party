import test from 'node:test'
import assert from 'node:assert/strict'
import { createDemoMcpHandler } from '../lib/pennycore-mcp-demo.js'
import { validateMegaSeed } from '../src/nexus/megaseed.js'
function request(method,params={},opts={}){
 const h=createDemoMcpHandler(),headers={}
 const res={setHeader(k,v){headers[k]=v},status(code){this.code=code;return this},json(value){this.value=value;return this},end(){return this}}
 const req={method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream'},query:{},body:{jsonrpc:'2.0',id:1,method,params},...opts}
 h(req,res);return {code:res.code,body:res.value,headers}
}
test('Google supported handshake and fixed tool schema',()=>{
 for(const version of ['2025-03-26','2025-06-18','2025-11-25']){
  const r=request('initialize',{protocolVersion:version,capabilities:{},clientInfo:{name:'synthetic-client',version:'1'}})
  assert.equal(r.code,200);assert.equal(r.body.result.protocolVersion,version);assert.deepEqual(r.body.result.capabilities,{tools:{}})
 }
 const r=request('tools/list')
 assert.equal(r.body.result.tools.length,1)
 assert.equal(r.body.result.tools[0].name,'get_demo_megaseed')
 assert.equal(r.body.result.tools[0].annotations.readOnlyHint,true)
 assert.equal(r.body.result.tools[0].inputSchema.additionalProperties,false)
 assert.equal(request('notifications/initialized',{}, {body:{jsonrpc:'2.0',method:'notifications/initialized'}}).code,202)
})
test('only fixed synthetic MegaSeed; no writes or arbitrary record lookup',()=>{
 const r=request('tools/call',{name:'get_demo_megaseed',arguments:{}})
 const value=JSON.parse(r.body.result.content[0].text)
 assert.equal(value.synthetic,true);assert.equal(value.readOnly,true)
 assert.match(value.packet.state,/LANTERN-ORBIT-47/)
 assert.deepEqual(validateMegaSeed(value.packet),value.packet)
 for(const name of ['get_real_memory','save_megaseed','delete_memory','list_records']){
  assert.equal(request('tools/call',{name,arguments:{}}).body.error.code,-32602)
 }
 const invalid=request('tools/call',{name:'get_demo_megaseed',arguments:{query:'private-content-canary'}})
 assert.equal(invalid.body.result.isError,true);assert.ok(!JSON.stringify(invalid.body).includes('private-content-canary'))
 assert.equal(request('resources/list').body.error.code,-32601)
})
test('transport rejects unexpected origins, methods, input and oversized requests',()=>{
 assert.equal(request('ping',{}, {headers:{origin:'https://untrusted.example'}}).code,403)
 assert.equal(request('ping',{}, {method:'GET'}).code,405)
 assert.equal(request('ping',{}, {query:{account:'anything'}}).code,400)
 assert.equal(request('ping',{}, {headers:{'content-type':'text/plain'}}).code,415)
 assert.equal(request('ping',{}, {headers:{'content-type':'application/json',accept:'text/html'}}).code,406)
 assert.equal(request('ping',{}, {headers:{'content-type':'application/json','mcp-protocol-version':'unknown'}}).code,400)
 assert.equal(request('ping',{}, {body:'{broken'}).body.error.code,-32700)
 assert.equal(request('ping',{}, {body:'x'.repeat(8193)}).code,413)
 assert.equal(request('ping',{}, {body:[{jsonrpc:'2.0',method:'ping',id:1}]}).body.error.code,-32600)
 assert.equal(request('ping').headers['Cache-Control'],'no-store')
})
