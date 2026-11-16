import React,{useEffect,useState,useMemo,useRef} from 'react'
import {createRoot} from 'react-dom/client'
import './workspace.css'
import {FIELDS as fields,SOURCES,SAVE_PROMPT,importMegaSeed,validateMegaSeed} from './megaseed.js'
import {bridgeConfig,acceptBridgeMessage,restoreBundle} from './bridge.js'
import {MAX_SELECTED,SCAN_PAGES,PROVIDERS,mergeRecords,findRecords,handoff} from './workbench.js'

const empty={source:'chatgpt',title:'',state:'',context:'',memory:'',nextStep:''}
async function request(path,options={}){
 const r=await fetch(path,{...options,credentials:'same-origin',cache:'no-store'})
 const data=await r.json().catch(()=>({}))
 if(!r.ok)throw Object.assign(Error(data.error||'Workspace request failed.'),{status:r.status})
 return data
}
const post=(path,body)=>request(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
const getPage=before=>request('/api/nexus-memory?view=records'+(before?'&before='+encodeURIComponent(before):''))
const packetText=r=>fields.map(([f,label])=>label+': '+r[f]).join('\n\n')
function App(){
 const [bridge]=useState(()=>bridgeConfig(location.search)),[tab,setTab]=useState(bridge?.mode==='pair'?'pair':bridge?.mode==='save'?'save':'memory')
 const [bridgeReceived,setBridgeReceived]=useState(false),[bridgeReady,setBridgeReady]=useState(false),[bridgeDone,setBridgeDone]=useState(false),[sending,setSending]=useState(false)
 const [gate,setGate]=useState(null),[checking,setChecking]=useState(true),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[error,setError]=useState('')
 const [handle,setHandle]=useState(''),[password,setPassword]=useState('')
 const [raw,setRaw]=useState(''),[draft,setDraft]=useState(empty),[pending,setPending]=useState(null),[review,setReview]=useState(false)
 const [records,setRecords]=useState([]),[next,setNext]=useState(null),[project,setProject]=useState(null)
 const [query,setQuery]=useState(''),[sourceFilter,setSourceFilter]=useState('all'),[selected,setSelected]=useState([]),[shareReview,setShareReview]=useState(false),[exportText,setExportText]=useState('')
 const delivery=useRef(null),ackTimer=useRef(null),receivedDraft=useRef(false)
 function clear(){
  setGate(null);setRaw('');setDraft(empty);setPending(null);setReview(false);setRecords([]);setNext(null);setProject(null);setQuery('');setSourceFilter('all');setSelected([]);setShareReview(false);setExportText('');setPassword('');setNotice('');setBridgeReady(false);setBridgeReceived(false);receivedDraft.current=false;setSending(false);clearTimeout(ackTimer.current);delivery.current=null
 }
 function fail(e){if([401,403].includes(e.status))clear();setError(e.message)}
 function invalidateShare(){setShareReview(false);setExportText('')}
 async function check(){
  try{
   const status=await request('/api/nexus-memory?view=status')
   if(status.memoryReady){try{const page=await getPage(null);setRecords(page.records);setNext(page.nextBefore)}catch(e){if([401,403].includes(e.status))throw e;setError(e.message)}}
   setGate(status)
  }catch(e){clear();if(e.status!==401)setError(e.message)}finally{setChecking(false)}
 }
 useEffect(()=>{check();const handler=e=>{if(e.persisted)location.reload()};window.addEventListener('pageshow',handler);return()=>{window.removeEventListener('pageshow',handler);clearTimeout(ackTimer.current)}},[])
 useEffect(()=>{
  if(!bridge||!gate?.memoryReady||bridgeDone)return
  const opener=window.opener
  if(!opener||opener.closed){setError('Local Nexus window is no longer connected. Close this window and start Restore or Save again from your local Nexus.');return}
  const ready=()=>opener.postMessage({type:'nexus:continuity:ready:v1',id:bridge.id,mode:bridge.mode},bridge.origin)
  const receive=e=>{
   try{
    const m=acceptBridgeMessage(bridge,e,opener);if(!m)return
    if(m.type==='hello'){setBridgeReady(true);return}
    if(m.type==='device-ack'){clearTimeout(ackTimer.current);setSending(false);if(m.ok){setBridgeDone(true);setNotice('Workstation connected. Automatic local continuity is enabled.');setError('')}else setError('Local enrollment was not confirmed. Close and retry from Nexus.');return}
    if(m.type==='draft'&&!receivedDraft.current){receivedDraft.current=true;setBridgeReceived(true);setBridgeReady(true);setDraft(m.draft);setPending(null);setReview(false);setRaw('');setNotice('Draft received. Review and save.');return}
    if(m.type==='ack'&&delivery.current){
     clearTimeout(ackTimer.current);setSending(false)
     if(m.ok&&m.count===delivery.current.length&&m.sessionId===bridge.id){setBridgeDone(true);setNotice(m.count+' memories restored and encrypted locally. Return to Nexus.');setError('')}
     else setError('Local storage was not confirmed. Retry Restore, or cancel and reopen from Nexus.')
    }
   }catch(err){setError(err.message)}
  }
  window.addEventListener('message',receive);ready()
  const pulse=setInterval(()=>{if(!opener.closed)ready()},1500)
  return()=>{window.removeEventListener('message',receive);clearInterval(pulse)}
 },[bridge,gate?.memoryReady,bridgeDone])
 async function login(e){e.preventDefault();setBusy(true);setError('');try{await post('/api/auth/login',{handle,password});setPassword('');await check()}catch(e){fail(e)}finally{setBusy(false)}}
 async function logout(){setBusy(true);setError('');try{await post('/api/auth/logout',{});clear();setHandle('');setNotice('Signed out.')}catch(e){clear();setError('Local workspace cleared. Server sign-out not confirmed; close this browser and retry sign-out.')}finally{setBusy(false)}}
 async function refresh(){setBusy(true);setError('');invalidateShare();try{const page=await getPage(null);setRecords(page.records);setNext(page.nextBefore);setSelected([]);setNotice('Latest memories loaded.')}catch(e){fail(e)}finally{setBusy(false)}}
 async function loadOlder(pages=1){
  if(!next||busy)return;setBusy(true);setError('');invalidateShare()
  try{let cursor=next,count=0;for(let i=0;i<pages&&cursor;i++){const page=await getPage(cursor);if(page.nextBefore===cursor)throw Error('Memory cursor did not advance.');setRecords(old=>mergeRecords(old,page.records));setNext(page.nextBefore);cursor=page.nextBefore;count+=page.records.length}setNotice(count+' older memories loaded.')}
  catch(e){fail(e)}finally{setBusy(false)}
 }
 function update(k,v){setDraft(d=>({...d,[k]:v}));setPending(null);setReview(false)}
 function changeRaw(value){setRaw(value);setReview(false);setPending(null)}
 function importPacket(value=raw){setError('');setNotice('');setReview(false);setPending(null);try{const p=importMegaSeed(value);setDraft(d=>({...p,source:d.source}));setRaw('');setNotice('MegaSeed validated. Review before saving.')}catch(e){setRaw(typeof value==='string'?value.slice(0,100000):'');setError(e.message)}}
 async function pasteClipboard(){setBusy(true);setError('');try{importPacket(await navigator.clipboard.readText())}catch{setNotice('Clipboard unavailable. Paste into the JSON box instead.')}finally{setBusy(false)}}
 async function capture(e){
  e.preventDefault();if(!review||busy||!gate?.memoryReady||raw.trim()||bridge?.mode==='save'&&(!bridgeReceived||bridgeDone))return
  let p;try{p=pending||{requestId:crypto.randomUUID(),source:draft.source,...validateMegaSeed(Object.fromEntries(fields.map(([k])=>[k,draft[k]])))}}catch(e){setError(e.message);return}
  setPending(p);setBusy(true);setError('')
  try{const r=await post('/api/nexus-memory',p);setRecords(old=>mergeRecords(old,[r.record]));setPending(null);setDraft({...empty,source:draft.source});setReview(false);setRaw('');invalidateShare()
   if(bridge?.mode==='save'){setBridgeDone(true);if(window.opener&&!window.opener.closed)window.opener.postMessage({type:'nexus:continuity:saved:v1',id:bridge.id,receipt:{id:r.record.id,duplicate:r.duplicate}},bridge.origin)}
   setNotice(r.duplicate?'Identical MegaSeed already saved. Source receipt recorded.':'Capture saved to encrypted cloud memory.')
  }catch(e){fail(e)}finally{setBusy(false)}
 }
 async function loadProject(){setBusy(true);setError('');try{setProject((await request('/api/penny-owner?view=records')).records)}catch(e){fail(e)}finally{setBusy(false)}}
 async function copy(value){setExportText(value);try{await navigator.clipboard.writeText(value);setNotice('Copied. Paste only into the intended provider.')}catch{setNotice('Clipboard unavailable. Select the text in the preview.')}}
 const matching=useMemo(()=>findRecords(records,query,sourceFilter),[records,query,sourceFilter])
 const chosen=useMemo(()=>selected.map(id=>records.find(r=>r.id===id)).filter(Boolean),[records,selected])
 const bundle=useMemo(()=>{try{return {text:chosen.length?handoff(chosen):'',records:bridge?.mode==='restore'&&chosen.length?restoreBundle(chosen):null,error:''}}catch(e){return {text:'',records:null,error:e.message}}},[chosen,bridge])
 const locked=busy||sending||bridgeDone||!!delivery.current
 function toggle(id,checked){if(locked)return;invalidateShare();setSelected(old=>checked?(old.length<MAX_SELECTED&&!old.includes(id)?[...old,id]:old):old.filter(x=>x!==id))}
 function suggest(){invalidateShare();setSelected(matching.slice(0,3).map(r=>r.id));setNotice('Selected up to three matching memories. Review before sharing.')}
 function launch(url){if(!shareReview||!bundle.text||busy)return;void copy(bundle.text);window.open(url,'_blank','noopener,noreferrer')}
 function deliverRestore(){
  if(!bridge||bridge.mode!=='restore'||bridgeDone||sending||!shareReview||!bundle.records)return
  if(!bridgeReady||!window.opener||window.opener.closed){setError('Local Nexus is not connected. Close and reopen Restore from Nexus.');return}
  setError('');setSending(true);delivery.current=bundle.records
  try{window.opener.postMessage({type:'nexus:continuity:restore:v2',id:bridge.id,records:delivery.current},bridge.origin);setNotice('Restoring to encrypted local storage…');clearTimeout(ackTimer.current);ackTimer.current=setTimeout(()=>{setSending(false);setError('No local storage receipt arrived. Retry the same restore, or close and reopen from Nexus.')},15000)}
  catch{setSending(false);setError('Could not reach the local Nexus. Retry or reopen the restore window.')}
 }
 async function pairDevice(){
  if(bridge?.mode!=='pair'||!bridgeReady||!shareReview||sending||bridgeDone||!window.opener||window.opener.closed)return
  setSending(true);setError('')
  try{const result=await post('/api/nexus-device?action=pair',{deviceId:bridge.id,approved:true})
   if(typeof result.grant!=='string'||!Number.isSafeInteger(result.expires))throw Error('Invalid enrollment response.')
   window.opener.postMessage({type:'nexus:device:grant:v1',id:bridge.id,grant:result.grant,expires:result.expires},bridge.origin)
   setNotice('Connecting workstation…');clearTimeout(ackTimer.current);ackTimer.current=setTimeout(()=>{setSending(false);setError('Workstation did not confirm enrollment. Retry or close.')},20000)
  }catch(e){setSending(false);fail(e)}
 }
 function closeBridge(){window.close();setNotice('Return to your local Nexus.')}
 return <main className="nx-shell nx-workspace">
 <header><a href="https://nexus.wildcarddev.com/">♠ THE N€XU$</a><span>{gate?'OWNER WORKSPACE · MARK III':'PRIVATE ENTRY'}</span>{gate&&<button type="button" disabled={busy||sending} onClick={logout}>Sign out</button>}</header>
 <div className="nx-status" aria-live="polite">{error&&<p role="alert" className="nx-error">{error}</p>}{notice&&<p role="status">{notice}</p>}</div>
 {checking?<p role="status">Verifying your session…</p>:!gate?<section className="nx-panel"><h1>Operator Gate</h1><p>Sign in with your existing WildCard Party account.</p><form onSubmit={login}><label>Handle<input required autoComplete="username" value={handle} onChange={e=>setHandle(e.target.value)}/></label><label>Password<input required type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)}/></label><button disabled={busy}>Sign in</button></form></section>:<>
 <section className="nx-panel nx-task"><div className="nx-row"><div><h1>{bridge?.mode==='restore'?'Restore memories':bridge?.mode==='save'?'Save point':bridge?.mode==='pair'?'Connect this workstation':'PennyCore command center'}</h1><p>{bridge?bridgeDone?'Transaction confirmed.':bridgeReady?'Local Nexus connected. No external engine receives this data.':'Waiting for local Nexus connection…':'Your encrypted memory bank. Choose a task.'}</p></div>{bridge&&<button type="button" onClick={closeBridge}>{bridgeDone?'Return to Nexus':'Cancel / close'}</button>}</div>
 {!bridge&&<nav className="nx-tabs" aria-label="Workspace tasks">{[['memory','Memory bank / Restore'],['save','Save / Import'],['engines','Engines'],['project','Project records']].map(([key,label])=><button key={key} aria-pressed={tab===key} disabled={busy} onClick={()=>{setTab(key);setError('');setNotice('')}}>{label}</button>)}</nav>}
 </section>
 {bridgeDone?<section className="nx-panel"><h2>Complete</h2><p>{notice||'Your transaction has finished.'}</p><button type="button" onClick={closeBridge}>Return to local Nexus</button></section>:<>
 {tab==='pair'&&<section className="nx-panel"><h2>One-time workstation approval</h2><p>Allow the private local Nexus to read your encrypted journal and append routine checkpoints. No memory is sent to external AI providers. This permission expires with this WildCard login (at most 30 days). Signing out of this browser session revokes the grant. You can disconnect locally at any time.</p><label className="nx-check"><input type="checkbox" checked={shareReview} disabled={sending} onChange={e=>setShareReview(e.target.checked)}/> Allow automatic retrieval and first-party checkpoint synchronization on this workstation.</label><button className="nx-primary" disabled={!bridgeReady||!shareReview||sending||!gate.memoryReady} onClick={pairDevice}>{sending?'Connecting…':'Connect workstation'}</button></section>}
 {tab==='memory'&&<section className="nx-panel"><div className="nx-row"><h2>Memory bank</h2><button type="button" disabled={locked} onClick={refresh}>Refresh</button></div>
 {!gate.memoryReady?<p>Encrypted memory is unavailable.</p>:<>
 <div className="nx-filters"><label>Search memories<input value={query} maxLength={240} onChange={e=>setQuery(e.target.value)} placeholder="Find a topic or project" disabled={locked}/></label><label>Source<select value={sourceFilter} onChange={e=>setSourceFilter(e.target.value)} disabled={locked}><option value="all">All providers</option>{SOURCES.map(s=><option key={s} value={s}>{s}</option>)}</select></label></div>
 <div className="nx-actions"><button disabled={locked||!matching.length} onClick={()=>{invalidateShare();setSelected(matching.slice(0,MAX_SELECTED).map(r=>r.id))}}>Select all (up to 6)</button><button disabled={locked||!selected.length} onClick={()=>{invalidateShare();setSelected([])}}>Clear selection</button><button disabled={locked||!matching.length} onClick={suggest}>Suggest 3</button>{next&&<button disabled={locked} onClick={()=>loadOlder(SCAN_PAGES)}>Load older</button>}</div>
 <div className="nx-memory-grid"><div className="nx-memory-list"><p className="nx-muted">{records.length} loaded · {matching.length} matching · {selected.length}/{MAX_SELECTED} selected</p>{!matching.length&&<p>No matching memories.</p>}
 {matching.map(r=><article className={'nx-record'+(selected.includes(r.id)?' nx-selected':'')} key={r.id}><label className="nx-check nx-record-title"><input type="checkbox" checked={selected.includes(r.id)} disabled={locked||(!selected.includes(r.id)&&selected.length>=MAX_SELECTED)} onChange={e=>toggle(r.id,e.target.checked)}/><span>{r.title}</span></label><p className="nx-muted">{(r.sources||[r.source]).join(' / ')} · {new Date(r.createdAt).toLocaleString()}</p><details><summary>Review memory</summary><pre>{packetText(r)}</pre></details></article>)}
 {next&&<button disabled={locked} onClick={()=>loadOlder()}>Load next page</button>}</div>
 <aside className="nx-review" aria-label="Restore selection"><h2>{bridge?'Restore to Nexus':'Restore / export'}</h2><p>{chosen.length} selected of {MAX_SELECTED}. {bridge?'Only selected memories are stored locally.':'Only selected memories are copied.'}</p>
 {!chosen.length?<p>Select memories to begin.</p>:<><ol>{chosen.map(r=><li key={r.id}>{r.title}</li>)}</ol>{bundle.error?<p role="alert" className="nx-error">{bundle.error}</p>:<>
 <label className="nx-check"><input type="checkbox" checked={shareReview} disabled={locked} onChange={e=>setShareReview(e.target.checked)}/>{bridge?'I approve storing these memories in my private local Nexus.':'I approve copying these memories to the provider I choose.'}</label>
 {bridge?<><button className="nx-primary" disabled={busy||sending||!bridgeReady||!shareReview} onClick={deliverRestore}>{sending?'Restoring…':delivery.current?'Retry restore':'Restore selected memories'}</button><p className="nx-muted">{!bridgeReady?'Waiting for local connection.':!shareReview?'Check approval to enable Restore.':'Full records stay local; model context is bounded and visibly identified.'}</p></>:<><button className="nx-primary" disabled={busy||!shareReview} onClick={()=>copy(bundle.text)}>Copy restore point</button><div className="nx-actions">{PROVIDERS.map(([id,name,url])=><button key={id} disabled={busy||!shareReview} onClick={()=>launch(url)}>Copy & open {name}</button>)}</div></>}
 <details><summary>Exact restore bundle</summary><textarea aria-label="Exact restore bundle" readOnly rows="10" value={bundle.text}/></details></>}</>}
 </aside></div></>}</section>}
 {tab==='save'&&<section className="nx-panel"><h2>Save / import memory</h2><p>{bridge?'Review the local draft and save.':'Import a five-field MegaSeed from any engine.'}</p>
 {!bridge&&<><div className="nx-actions"><button disabled={busy} onClick={()=>copy(SAVE_PROMPT)}>Copy save-point command</button><button disabled={busy} onClick={pasteClipboard}>Paste & validate clipboard</button></div><label htmlFor="nx-megaseed">MegaSeed JSON</label><textarea id="nx-megaseed" rows="4" value={raw} maxLength={100000} disabled={busy} onChange={e=>changeRaw(e.target.value)} onPaste={e=>{const value=e.clipboardData.getData('text');if(value){e.preventDefault();importPacket(value)}}}/><div className="nx-actions"><button disabled={busy||!raw.trim()} onClick={()=>importPacket()}>Validate and import</button><button disabled={busy||!raw} onClick={()=>changeRaw('')}>Clear</button></div></>}
 <form onSubmit={capture}><label>Source<select value={draft.source} onChange={e=>update('source',e.target.value)} disabled={busy}>{SOURCES.map(x=><option key={x} value={x}>{x}</option>)}</select></label>{fields.map(([k,label,max])=><label key={k}>{label}{k==='title'?<input required maxLength={max} value={draft[k]} onChange={e=>update(k,e.target.value)} disabled={busy}/>:<textarea rows="3" maxLength={max} value={draft[k]} onChange={e=>update(k,e.target.value)} disabled={busy}/>}</label>)}<label className="nx-check"><input type="checkbox" checked={review} onChange={e=>setReview(e.target.checked)} disabled={busy||!!raw.trim()}/> I reviewed this capture and removed secrets.</label><button className="nx-primary" disabled={busy||!gate.memoryReady||!review||!draft.title.trim()||!!raw.trim()||!!(bridge&&!bridgeReceived)}>Save capture</button></form><p className="nx-muted">Encrypted at rest with a server-managed key. Source is Owner attribution.</p></section>}
 {!bridge&&tab==='engines'&&<section className="nx-panel"><h2>Engine launchers</h2><p>Open your own provider accounts. This workspace does not make inference calls.</p><div className="nx-grid">{PROVIDERS.map(([id,name,url])=><a key={id} className="nx-link" href={url} target="_blank" rel="noopener noreferrer">{name} ↗</a>)}</div></section>}
 {!bridge&&tab==='project'&&<section className="nx-panel"><h2>Approved project memory</h2><button disabled={busy||!gate.projectReady} onClick={loadProject}>Load approved records</button>{!gate.projectReady&&<p>Project memory not configured.</p>}{project?.map(r=><details key={r.kind+'/'+r.key}><summary>{r.kind}/{r.key}</summary><pre>{r.available?JSON.stringify(r.payload,null,2):'No record available.'}</pre></details>)}</section>}
 {exportText&&<section className="nx-panel"><h2>Clipboard preview</h2><textarea aria-label="Copied text" readOnly rows="6" value={exportText}/><button onClick={()=>setExportText('')}>Clear preview</button></section>}
 </>}
 </>}
 <footer>WILDCARD DEV · OWNER GATE</footer></main>
}
createRoot(document.getElementById('root')).render(<App/>)
