import React,{useEffect,useState,useMemo} from 'react'
import {createRoot} from 'react-dom/client'
import './workspace.css'
import { FIELDS as fields, SOURCES, SAVE_PROMPT, importMegaSeed, validateMegaSeed } from './megaseed.js'
import {bridgeConfig,acceptDraft,restoreRecord} from './bridge.js'
import { MAX_SELECTED, SCAN_PAGES, PROVIDERS, mergeRecords, findRecords, handoff } from './workbench.js'

const empty={source:'chatgpt',title:'',state:'',context:'',memory:'',nextStep:''}
async function request(path,options={}){
 const r=await fetch(path,{...options,credentials:'same-origin',cache:'no-store'})
 const data=await r.json().catch(()=>({}))
 if(!r.ok)throw Object.assign(Error(data.error||'Workspace request failed.'),{status:r.status})
 return data
}
const post=(path,body)=>request(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
const getPage=before=>request('/api/nexus-memory?view=records'+(before?'&before='+encodeURIComponent(before):''))
function packetText(r){return fields.map(([f,label])=>label+': '+r[f]).join('\n\n')}

function App(){
 const [bridge]=useState(()=>bridgeConfig(window.location.search)),[bridgeReceived,setBridgeReceived]=useState(false),[bridgeDone,setBridgeDone]=useState(false)
 const [gate,setGate]=useState(null),[checking,setChecking]=useState(true),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[error,setError]=useState('')
 const [handle,setHandle]=useState(''),[password,setPassword]=useState('')
 const [raw,setRaw]=useState(''),[draft,setDraft]=useState(empty),[pending,setPending]=useState(null),[review,setReview]=useState(false)
 const [records,setRecords]=useState([]),[next,setNext]=useState(null),[project,setProject]=useState(null)
 const [query,setQuery]=useState(''),[sourceFilter,setSourceFilter]=useState('all'),[selected,setSelected]=useState([]),[shareReview,setShareReview]=useState(false)
 const [exportText,setExportText]=useState('')
 function clear(){
  setGate(null);setRaw('');setDraft(empty);setPending(null);setReview(false);setRecords([]);setNext(null);setProject(null);setQuery('');setSourceFilter('all');setSelected([]);setShareReview(false);setExportText('');setPassword('');setNotice('')
 }
 function fail(e){if([401,403].includes(e.status))clear();setError(e.message)}
 function invalidateShare(){setShareReview(false);setExportText('')}
 async function check(){
  try{
   const status=await request('/api/nexus-memory?view=status')
   if(status.memoryReady){
    try{const page=await getPage(null);setRecords(page.records);setNext(page.nextBefore)}
    catch(e){if([401,403].includes(e.status))throw e;setError(e.message)}
   }
   setGate(status)
  }catch(e){clear();if(e.status!==401)setError(e.message)}finally{setChecking(false)}
 }
 useEffect(()=>{check();const handler=e=>{if(e.persisted)window.location.reload()};window.addEventListener('pageshow',handler);return()=>window.removeEventListener('pageshow',handler)},[])
 useEffect(()=>{
  if(!bridge||!gate?.memoryReady||!window.opener||bridgeDone||bridgeReceived)return
  const opener=window.opener
  const receive=e=>{try{const d=acceptDraft(bridge,e,opener);if(!d)return;setDraft(d);setPending(null);setReview(false);setRaw('');setBridgeReceived(true);setNotice('Local Nexus draft received. Review exact content before saving.')}catch(err){setError(err.message)}}
  window.addEventListener('message',receive)
  opener.postMessage({type:'nexus:continuity:ready:v1',id:bridge.id,mode:bridge.mode},bridge.origin)
  return()=>window.removeEventListener('message',receive)
 },[bridge,gate?.memoryReady,bridgeDone,bridgeReceived])
 function deliverRestore(){
  if(!bridge||bridge.mode!=='restore'||bridgeDone||!gate?.memoryReady||!shareReview||chosen.length!==1||!window.opener)return
  try{const record=restoreRecord(chosen[0]);window.opener.postMessage({type:'nexus:continuity:restore:v1',id:bridge.id,record},bridge.origin);setBridgeDone(true);setShareReview(false);setNotice('Selected memory delivered to the local Nexus. No engine received it.')}catch(e){setError(e.message)}
 }
 async function login(e){e.preventDefault();setBusy(true);setError('');try{await post('/api/auth/login',{handle,password});setPassword('');await check()}catch(e){fail(e)}finally{setBusy(false)}}
 async function logout(){setBusy(true);setError('');try{await post('/api/auth/logout',{});clear();setHandle('');setNotice('Signed out.')}catch(e){clear();setError('Local workspace cleared. Server sign-out not confirmed; close this browser and retry sign-out.')}finally{setBusy(false)}}
 async function refresh(){
  setBusy(true);setError('');invalidateShare()
  try{const page=await getPage(null);setRecords(page.records);setNext(page.nextBefore);setSelected([]);setNotice('Latest memories loaded.')}
  catch(e){fail(e)}finally{setBusy(false)}
 }
 async function loadOlder(pages=1){
  if(!next||busy)return
  setBusy(true);setError('');invalidateShare()
  try{
   let cursor=next,count=0
   for(let i=0;i<pages&&cursor;i++){
    const page=await getPage(cursor)
    if(page.nextBefore===cursor)throw Error('Memory cursor did not advance.')
    setRecords(old=>mergeRecords(old,page.records));setNext(page.nextBefore);cursor=page.nextBefore;count+=page.records.length
   }
   setNotice(count+' older memories loaded. '+(cursor?'More are available.':'All available pages are loaded.'))
  }catch(e){fail(e)}finally{setBusy(false)}
 }
 function update(k,v){setDraft(d=>({...d,[k]:v}));setPending(null);setReview(false)}
 function changeRaw(value){setRaw(value);setReview(false);setPending(null)}
 function importPacket(value=raw){
  setError('');setNotice('');setReview(false);setPending(null)
  try{const p=importMegaSeed(value);setDraft(d=>({...p,source:d.source}));setRaw('');setNotice('MegaSeed validated and imported. Confirm its source and review before saving.')}
  catch(e){setRaw(typeof value==='string'?value.slice(0,100000):'');setError(e.message)}
 }
 async function pasteClipboard(){
  setBusy(true);setError('')
  try{const value=await navigator.clipboard.readText();importPacket(value)}
  catch{setNotice('Clipboard access unavailable. Paste into the JSON box instead.')}
  finally{setBusy(false)}
 }
 async function capture(e){
  e.preventDefault();if(!review||busy||!gate?.memoryReady||raw.trim())return
  let p
  try{const fieldsOnly=Object.fromEntries(fields.map(([k])=>[k,draft[k]]));p=pending||{requestId:crypto.randomUUID(),source:draft.source,...validateMegaSeed(fieldsOnly)}}
  catch(e){setError(e.message);return}
  if(bridge?.mode==='save'&&!bridgeReceived)return
  setPending(p);setBusy(true);setError('')
  try{
   const r=await post('/api/nexus-memory',p)
   if(bridge?.mode==='save'&&window.opener&&!bridgeDone){window.opener.postMessage({type:'nexus:continuity:saved:v1',id:bridge.id,receipt:{id:r.record.id,duplicate:r.duplicate}},bridge.origin);setBridgeDone(true)}
   setRecords(old=>mergeRecords(old,[r.record]));setPending(null);setDraft({...empty,source:draft.source});setReview(false);setRaw('');invalidateShare()
   setNotice(r.duplicate?'Identical MegaSeed already saved. Source receipt recorded.':'Capture saved to encrypted cloud memory.')
  }catch(e){fail(e)}finally{setBusy(false)}
 }
 async function loadProject(){setBusy(true);setError('');try{setProject((await request('/api/penny-owner?view=records')).records)}catch(e){fail(e)}finally{setBusy(false)}}
 async function copy(value){
  setExportText(value)
  try{await navigator.clipboard.writeText(value);setNotice('Copied. Paste only into the intended provider.')}
  catch{setNotice('Clipboard unavailable. Select and copy the text in the preview.')}
 }
 const matching=useMemo(()=>findRecords(records,query,sourceFilter),[records,query,sourceFilter])
 const chosen=useMemo(()=>selected.map(id=>records.find(r=>r.id===id)).filter(Boolean),[records,selected])
 const bundle=useMemo(()=>{try{return {text:chosen.length?handoff(chosen):'',error:''}}catch(e){return {text:'',error:e.message}}},[chosen])
 function toggle(id,checked){invalidateShare();setSelected(old=>checked?(old.length<(bridge?.mode==='restore'?1:MAX_SELECTED)&&!old.includes(id)?[...old,id]:old):old.filter(x=>x!==id))}
 function suggest(){invalidateShare();setSelected(matching.slice(0,bridge?.mode==='restore'?1:Math.min(3,MAX_SELECTED)).map(r=>r.id));setNotice('Selected up to three matching memories. Review before sharing.')}
 function launch(url){
  if(!shareReview||!bundle.text||busy)return
  // The reviewed text stays in the clipboard; never include it in a URL.
  void copy(bundle.text)
  window.open(url,'_blank','noopener,noreferrer')
 }
 return <main className="nx-shell">
 <header><a href="https://nexus.wildcarddev.com/">♠ THE N€XU$</a><span>{gate?'OWNER WORKSPACE · MARK II':'PRIVATE ENTRY'}</span></header>
 {bridge&&<section className="nx-panel"><h2>Local Nexus · {bridge.mode==='save'?'Save point':'Restore point'}</h2><p>Only your local console at {bridge.origin} receives this transaction. No provider is contacted. {bridgeDone?'Transaction complete; return to your local console.':bridge.mode==='save'?'Review the incoming draft, then save below.':'Select exactly one record and approve delivery to your local console.'}</p></section>}
 {error&&<p role="alert" className="nx-error">{error}</p>}{notice&&<p role="status">{notice}</p>}
 {checking?<p role="status">Verifying your session…</p>:!gate?<section className="nx-panel"><h1>Operator Gate</h1><p>Sign in with your existing WildCard Party account. Only the verified owner account can enter.</p><form onSubmit={login}><label>Handle<input required autoComplete="username" value={handle} onChange={e=>setHandle(e.target.value)}/></label><label>Password<input required type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)}/></label><button disabled={busy}>Sign in</button></form><button type="button" onClick={logout} disabled={busy}>Sign out of existing session</button></section>:<>
 <section className="nx-panel"><div className="nx-row"><h1>Private command center</h1><button type="button" onClick={logout} disabled={busy}>Sign out</button></div><p>Your owner identity has been verified. Launch your own provider accounts; this workspace makes no model inference calls and does not transfer credentials.</p><div className="nx-grid">{PROVIDERS.map(([id,name,url])=><a key={id} className="nx-link" href={url} target="_blank" rel="noopener noreferrer">{name} ↗</a>)}</div><p className="nx-muted">Native provider accounts only. Ollama remains local. Provider plans and usage limits apply.</p></section>
 <section className="nx-panel"><h2>Capture continuity</h2><p>Use Penny, save point in any engine. Import the JSON, confirm source and review before saving. Source is your attribution, not independently verified provider identity.</p>
 <div className="nx-actions"><button type="button" disabled={busy} onClick={()=>copy(SAVE_PROMPT)}>Copy save-point command</button><button type="button" disabled={busy} onClick={pasteClipboard}>Paste & validate clipboard</button></div>
 <div className="nx-import"><label htmlFor="nx-megaseed">Paste MegaSeed JSON</label><textarea id="nx-megaseed" rows="5" value={raw} maxLength={100000} disabled={busy} onChange={e=>changeRaw(e.target.value)} onPaste={e=>{const value=e.clipboardData.getData('text');if(value){e.preventDefault();importPacket(value)}}} placeholder="Paste one five-field JSON packet"/><div className="nx-actions"><button type="button" disabled={busy||!raw.trim()} onClick={()=>importPacket()}>Validate and import</button><button type="button" disabled={busy||!raw} onClick={()=>changeRaw('')}>Clear unimported text</button></div></div>
 {!gate.memoryReady&&<p className="nx-muted">Encrypted memory is unavailable. You can validate and review, but cannot save yet.</p>}
 <form onSubmit={capture}><label>Source<select value={draft.source} onChange={e=>update('source',e.target.value)} disabled={busy}>{SOURCES.map(x=><option key={x} value={x}>{x}</option>)}</select></label>{fields.map(([k,label,max])=><label key={k}>{label}{k==='title'?<input required maxLength={max} value={draft[k]} onChange={e=>update(k,e.target.value)} disabled={busy}/>:<textarea rows="3" maxLength={max} value={draft[k]} onChange={e=>update(k,e.target.value)} disabled={busy}/>}</label>)}<label className="nx-check"><input type="checkbox" checked={review} onChange={e=>setReview(e.target.checked)} disabled={busy||!!raw.trim()}/> I reviewed this capture and removed secrets. Save it to my private cloud memory.</label><button disabled={busy||!gate.memoryReady||!review||!draft.title.trim()||!!raw.trim()||!!(bridge?.mode==='save'&&(!bridgeReceived||bridgeDone))}>Save capture</button></form><p className="nx-muted">Encrypted at rest with a server-managed key, not end-to-end encryption. Never save passwords or confidential third-party material.</p></section>
 {gate.memoryReady&&<section className="nx-panel"><div className="nx-row"><h2>Memory bank</h2><button type="button" disabled={busy} onClick={refresh}>Refresh latest</button></div>
 <p className="nx-muted">{records.length} loaded · {matching.length} matching · {selected.length}/{MAX_SELECTED} selected. Search runs only in this browser over loaded records. {next?'More pages available.':'No more pages indicated.'}</p>
 <div className="nx-filters"><label>Find a project or topic<input value={query} maxLength={240} onChange={e=>setQuery(e.target.value)} placeholder="e.g. PennyCore, Merkabah, deployment" disabled={busy}/></label><label>Source<select value={sourceFilter} onChange={e=>setSourceFilter(e.target.value)} disabled={busy}><option value="all">All providers</option>{SOURCES.map(s=><option key={s} value={s}>{s}</option>)}</select></label></div>
 <div className="nx-actions"><button type="button" disabled={busy||!matching.length} onClick={suggest}>Suggest up to 3 matches</button><button type="button" disabled={busy||!selected.length} onClick={()=>{invalidateShare();setSelected([])}}>Clear selection</button>{next&&<button type="button" disabled={busy} onClick={()=>loadOlder(SCAN_PAGES)}>Load up to 100 older memories</button>}</div>
 {!matching.length&&<p>No matching loaded memories. {next?'Load older pages to search further.':''}</p>}
 {matching.map(r=><article className="nx-record" key={r.id}><label className="nx-check"><input type="checkbox" checked={selected.includes(r.id)} disabled={busy||(!selected.includes(r.id)&&selected.length>=(bridge?.mode==='restore'?1:MAX_SELECTED))} onChange={e=>toggle(r.id,e.target.checked)}/> Include in next handoff</label><h3>{r.title}</h3><p>{(r.sources||[r.source]).join(' / ')} · {new Date(r.createdAt).toLocaleString()}</p><details><summary>Review capture</summary><pre>{packetText(r)}</pre></details></article>)}
 {next&&<button type="button" disabled={busy} onClick={()=>loadOlder()}>Load next page</button>}
 </section>}
 {chosen.length>0&&<section className="nx-panel"><h2>Restore bundle</h2><p>{chosen.length} selected. Only these memories will be copied. Search suggestions do not authorize transfer.</p><ol>{chosen.map(r=><li key={r.id}>{r.title}</li>)}</ol>{bundle.error?<p role="alert" className="nx-error">{bundle.error}</p>:<><label>Review the exact handoff<textarea readOnly rows="8" value={bundle.text}/></label><label className="nx-check"><input type="checkbox" checked={shareReview} onChange={e=>setShareReview(e.target.checked)} disabled={busy}/> {bridge?.mode==='restore'?'I approve restoring this record to my private local Nexus only.':'I approve sharing these selected memories with the provider I choose.'}</label><div className="nx-actions">{bridge?.mode==='restore'?<button type="button" disabled={busy||!shareReview||chosen.length!==1||bridgeDone} onClick={deliverRestore}>Restore to local Nexus</button>:<><button type="button" disabled={busy||!shareReview} onClick={()=>copy(bundle.text)}>Copy restore point</button>{PROVIDERS.map(([id,name,url])=><button key={id} type="button" disabled={busy||!shareReview} onClick={()=>launch(url)}>Copy & open {name}</button>)}</>}</div><p className="nx-muted">The provider opens in a new tab; paste the reviewed text yourself. Nothing is automatically submitted.</p></>}</section>}
 {exportText&&<section className="nx-panel"><h2>Clipboard fallback</h2><textarea aria-label="Copied text" readOnly rows="6" value={exportText}/><button type="button" onClick={()=>setExportText('')}>Clear preview</button></section>}
 <section className="nx-panel"><h2>Approved project memory</h2><p>Read-only engineering records, separate from personal captures.</p><button type="button" onClick={loadProject} disabled={busy||!gate.projectReady}>Load approved records</button>{!gate.projectReady&&<p>Project memory is not configured.</p>}{project?.map(r=><details key={r.kind+'/'+r.key}><summary>{r.kind}/{r.key}</summary><pre>{r.available?JSON.stringify(r.payload,null,2):'No record available.'}</pre></details>)}</section>
 </>}
 <footer>WILDCARD DEV · OWNER GATE · Sign out on borrowed devices.</footer></main>
}
createRoot(document.getElementById('root')).render(<App/>)
