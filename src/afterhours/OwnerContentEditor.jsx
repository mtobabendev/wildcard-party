import { useEffect, useState } from 'react'
import { mergeCreatorDraft } from './ownerEditorRecovery.js'
import { fetchPrivateMediaPages } from './privateMediaPages.js'
import { emptyContent, emptyOrbitCards } from './contentModel.js'
import { STRIPAGRAM_POST_DEFAULTS } from './stripagramModel.js'
import { BUILTIN_POSTS } from './builtinPosts.js'
import { CATALOG_AREAS, CATALOG_SURFACES, createCatalog, parseCatalog, restoreDraft } from './catalogBackup.js'
const AREAS=['penny','kandy','ashley']
const api=(area,surface)=>'/api/afterhours/creator-content?area='+area+'&surface='+surface
export default function OwnerContentEditor({ mediaRevision = 0 }) {
  const [area,setArea]=useState('penny')
  const [surface,setSurface]=useState('afterhours')
  const strip=surface==='stripagram'
  const [content,setContent]=useState(emptyContent)
  const [media,setMedia]=useState([])
  const [revision,setRevision]=useState(0)
  const [base,setBase]=useState(null)
  const [ready,setReady]=useState(false)
  const [busy,setBusy]=useState(false)
  const [dirty,setDirty]=useState(false)
  const [message,setMessage]=useState('')
  const [reload,setReload]=useState(0)
  const [mediaRefresh,setMediaRefresh]=useState(0)
  const [mediaStatus,setMediaStatus]=useState('')
  const [catalog,setCatalog]=useState(null)
  const [catalogStatus,setCatalogStatus]=useState('')
  const [catalogBusy,setCatalogBusy]=useState(false)
  const refreshMedia=()=>setMediaRefresh(v=>v+1)
  useEffect(()=>{
    let active=true
    setReady(false);setDirty(false);setMedia([]);setMediaStatus('');setMessage('Loading creator content…')
    fetch(api(area,surface),{credentials:'same-origin',cache:'no-store'}).then(async r=>{
      const d=await r.json();if(!r.ok)throw Error(d.error||'Load failed')
      if(active){const loaded={...emptyContent(),...d.content};setContent(loaded);setBase(loaded);setMedia(d.media);setRevision(d.revision);setReady(true);setMessage('')}
    }).catch(e=>{if(active)setMessage(e.message)})
    return ()=>{active=false}
  },[area,surface,reload])
  // Refresh only the catalog; never replace an unsaved content draft or revision.
  useEffect(()=>{
    if(!ready)return
    const controller=new AbortController()
    setMediaStatus('Refreshing media…')
    fetchPrivateMediaPages(area, { signal: controller.signal })
      .then(items=>{if(!controller.signal.aborted){setMedia(items);setMediaStatus(items.length+' available media items')}})
      .catch(e=>{if(!controller.signal.aborted)setMediaStatus('Media refresh failed: '+e.message)})
    return ()=>controller.abort()
  },[area,ready,mediaRevision,mediaRefresh])
  useEffect(()=>{
    const refresh=()=>{if(!document.hidden)setMediaRefresh(v=>v+1)}
    window.addEventListener('focus',refresh)
    document.addEventListener('visibilitychange',refresh)
    return ()=>{window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',refresh)}
  },[])
  function edit(fn){setContent(fn);setDirty(true);setMessage('Unsaved changes')}
  function patchBuiltin(id,change){edit(c=>({...c,postOverrides:{...c.postOverrides,[id]:{...c.postOverrides?.[id],...change}}}))}
  function resetBuiltin(id){edit(c=>{const postOverrides={...c.postOverrides};delete postOverrides[id];return {...c,postOverrides}})}
  function patch(id,change){edit(c=>({...c,posts:c.posts.map(p=>p.id===id?{...p,...change}:p)}))}
  async function save(){
    if(!strip&&Object.values(content.postOverrides??{}).some(p=>p.mediaMode==='replace'&&!p.mediaId)){setMessage('Select a replacement attachment before saving.');return}
    setBusy(true);setMessage('Saving…')
    try{
      const submit=(revision,content)=>fetch(api(area,surface),{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision,content})})
      let r=await submit(revision,content)
      if(r.status===409 && base) {
        const fresh=await fetch(api(area,surface),{credentials:'same-origin',cache:'no-store'})
        const latest=await fresh.json()
        if(!fresh.ok)throw Error(latest.error||'Could not refresh saved content. Your edits are retained.')
        const merged=mergeCreatorDraft(base,content,{...emptyContent(),...latest.content})
        if(merged.conflicts.length)throw Error('Another session changed '+merged.conflicts.join(', ')+'. Your edits are retained; review the latest saved layout in a separate tab before reloading.')
        r=await submit(latest.revision,merged.content)
        if(r.status===409)throw Error('Content changed again during save. Your edits are retained; retry Save changes.')
      }
      const d=await r.json();if(!r.ok)throw Error(d.error||'Save failed')
      setContent(d.content);setBase(d.content);setRevision(d.revision);setDirty(false);setMessage('Saved. Refresh the creator page to see changes.')
    }catch(e){setMessage(e.message)}finally{setBusy(false)}
  }
  async function exportCatalog(){
    setCatalogBusy(true);setCatalogStatus('Reading saved layouts…')
    try{
      const pages=await Promise.all(CATALOG_AREAS.flatMap(a=>CATALOG_SURFACES.map(async s=>{
        const r=await fetch(api(a,s),{credentials:'same-origin',cache:'no-store'})
        const d=await r.json()
        if(!r.ok)throw Error(d.error||'Could not read '+a+'/'+s)
        return {area:a,surface:s,content:d.content,media:d.media}
      })))
      const backup=createCatalog(pages)
      const url=URL.createObjectURL(new Blob([JSON.stringify(backup,null,2)],{type:'application/json'}))
      try{const link=document.createElement('a');link.href=url;link.download='wildcard-catalog-'+new Date().toISOString().slice(0,10)+'.json';document.body.append(link);link.click();link.remove()}
      finally{setTimeout(()=>URL.revokeObjectURL(url),1000)}
      setCatalogStatus('Six saved layouts exported. Store this file privately with your original media.')
    }catch(e){setCatalogStatus('Export failed: '+e.message)}finally{setCatalogBusy(false)}
  }
  async function readCatalog(event){
    const file=event.target.files?.[0]
    event.target.value=''
    if(!file)return
    setCatalog(null);setCatalogBusy(true)
    try{
      if(file.size>2*1024*1024)throw Error('Catalog exceeds 2 MB.')
      setCatalog(parseCatalog(JSON.parse(await file.text())))
      setCatalogStatus('Six layouts loaded locally. Choose a page, then load it as an unsaved draft.')
    }catch(e){setCatalogStatus('Import failed: '+e.message)}finally{setCatalogBusy(false)}
  }
  function loadCatalogDraft(){
    if(!ready||!catalog||busy||catalogBusy)return
    if(dirty&&!window.confirm('Replace your unsaved draft with the backup?'))return
    try{
      const draft=restoreDraft(catalog,area,surface,media)
      edit(()=>draft)
      setCatalogStatus('Draft restored. Review it before saving. No server changes yet.')
    }catch(e){setCatalogStatus(e.message)}
  }
  const switchArea=e=>{if(!dirty||window.confirm('Discard unsaved edits?'))setArea(e.target.value)}
  const pick=(value,onChange,kind='all')=><select value={value||''} onChange={e=>onChange(e.target.value||null)} disabled={busy} style={{maxWidth:'100%',width:'100%'}}>
    <option value="">None / default</option>{media.filter(m=>kind==='all'||(kind==='image'&&m.type.startsWith('image/'))||(kind==='video'&&['video/mp4','video/webm'].includes(m.type))).map(m=><option key={m.id} value={m.id}>{m.name}</option>)}
    {value&&!media.some(m=>m.id===value)&&<option value={value}>Unavailable — choose another</option>}
  </select>
  return <section style={{maxWidth:920,margin:'16px auto',padding:16,border:'1px solid #99688f',borderRadius:16,background:'#22152c',color:'#fff'}}>
    <h2>Creator content manager</h2><p>Manage page content for each creator. Existing member permissions remain in force.</p>
    <label>Site <select value={surface} disabled={busy} onChange={e=>{if(!dirty||window.confirm('Discard unsaved edits?'))setSurface(e.target.value)}}><option value="afterhours">After Hours</option><option value="stripagram">StripaGram</option></select></label>{' '}
    <label>Creator <select value={area} onChange={switchArea} disabled={busy}>{AREAS.map(a=><option key={a}>{a}</option>)}</select></label>{' '}
    <button type="button" disabled={busy||!ready} onClick={refreshMedia}>Refresh media</button>{' '}
    <button type="button" disabled={busy} onClick={()=>{if(!dirty||window.confirm('Discard unsaved edits?'))setReload(v=>v+1)}}>Reload content</button>
    <p role="status" aria-live="polite">{mediaStatus}</p>
    <p><a href={'/afterhours-members.html?area='+area} target="_blank" rel="noopener noreferrer">Manage collections (move or remove)</a>{' · '}<a href={strip?'/stripagram/?profile='+area:'https://www.wildcarddev.com/'+area+'/after-hours'} target="_blank" rel="noopener noreferrer">Open creator page</a></p>
    <details style={{margin:'12px 0'}}>
      <summary>Portable catalog backup / restore</summary>
      <p>Export all six saved layouts and filename references to a local JSON file. Media bytes and account credentials are not included. This is not an atomic database snapshot. Import never saves automatically.</p>
      <button type="button" disabled={catalogBusy||busy||!ready} onClick={exportCatalog}>Export six saved layouts</button>{' '}
      <label>Load catalog file <input type="file" accept=".json,application/json" disabled={catalogBusy||busy} onChange={readCatalog}/></label>{' '}
      <button type="button" disabled={!catalog||!ready||catalogBusy||busy} onClick={loadCatalogDraft}>Load selected page as draft</button>
      <p role="status" style={{overflowWrap:'anywhere'}}>{catalogStatus}</p>
    </details>
    <p role="status">{message}</p>
    {!strip&&ready&&<p><a href="#existing-posts">Edit existing page posts</a></p>}
    {ready&&<fieldset disabled={busy} style={{border:0,padding:0,minWidth:0}}>
      {strip&&<section aria-label="StripaGram identity" style={{display:'grid',gap:8,marginBottom:16}}>
        <h3>StripaGram profile details</h3>
        <p>Changes apply to the authorized member view. Public demo artwork and private media permissions are unchanged.</p>
        {[['name','Display name',120],['handle','Handle (without @)',40],['mark','Profile symbol',12],['role','Role',100]].map(([field,label,max])=><label key={field}>{label} <input style={{width:'100%',boxSizing:'border-box'}} maxLength={max} value={content.profile?.[field]??''} onChange={e=>edit(c=>({...c,profile:{...c.profile,[field]:e.target.value}}))}/></label>)}
        <label>Bio <textarea style={{width:'100%',boxSizing:'border-box'}} rows={4} maxLength={2000} value={content.profile?.bio??''} onChange={e=>edit(c=>({...c,profile:{...c.profile,bio:e.target.value}}))}/></label>
      </section>}
      <h3>Profile banner</h3><label>Choose an existing image {pick(content.bannerId,id=>edit(c=>({...c,bannerId:id,coverVideoId:id?null:c.coverVideoId})),'image')}</label>
      <label>Animated cover / wallpaper {pick(content.coverVideoId,id=>edit(c=>({...c,coverVideoId:id,bannerId:id?null:c.bannerId})),'video')}</label>
      <h3>Circular profile avatar</h3><label>Image or video {pick(content.avatarId,id=>edit(c=>({...c,avatarId:id})))}</label>
      <section id="profile-video" aria-labelledby="profile-video-title" style={{scrollMarginTop:16,margin:'18px 0'}}>
        <h3 id="profile-video-title">Profile video</h3>
        <p>Optional video beneath the Profile heading. Choose None / default to hide the player.</p>
        <label>Video {pick(content.profileVideoId,id=>edit(c=>({...c,profileVideoId:id})),'video')}</label>
      </section>
      {!strip&&<section id="orbit-cards" aria-labelledby="orbit-cards-title" style={{margin:'18px 0',scrollMarginTop:16}}>
        <h3 id="orbit-cards-title">Spinner cards and matching tiles (01–08)</h3>
        <p>Each selection updates the card, its matching tile, and the card viewer together. The separate Photos gallery is unchanged.</p>
        <div style={{display:'grid',gap:12}}>
          {(content.orbitCards ?? emptyOrbitCards()).map((id,index)=><label key={index} style={{display:'grid',gap:4}}>
            Card / Photo {String(index+1).padStart(2,'0')}
            <select value={id??''} onChange={e=>edit(c=>({...c,orbitCards:(c.orbitCards??emptyOrbitCards()).map((v,i)=>i===index?(e.target.value||null):v)}))} style={{width:'100%',maxWidth:'100%'}}>
              <option value="">{area==='penny'?'Keep original':'Default blank card'}</option>
              <option value="blank">Blank card</option>
              {media.filter(m=>m.type.startsWith('image/')).map(m=><option key={m.id} value={m.id}>{m.name}</option>)}
              {id&&id!=='blank'&&!media.some(m=>m.id===id)&&<option value={id}>Unavailable — choose another</option>}
            </select>
          </label>)}
        </div>
        <button type="button" style={{marginTop:12}} onClick={()=>edit(c=>({...c,orbitCards:Array(8).fill('blank')}))}>Clear all eight cards</button>
      </section>}
      {!strip&&<section id="existing-posts" style={{margin:'18px 0',scrollMarginTop:16}}>
        <h3>Existing page posts</h3>
        <p>Edit the original posts without re-uploading their original artwork. Text changes preserve original media and controls. Hide or restore any original post.</p>
        {(BUILTIN_POSTS[area]??[]).map(p=>{
          const override=content.postOverrides?.[p.id]??{}
          const mode=override.mediaMode??'original'
          return <details key={p.id} style={{margin:'12px 0',padding:12,border:'1px solid #785879',borderRadius:8}}>
            <summary>{override.hidden?'Hidden: ':''}{override.title??p.title}</summary>
            <div style={{display:'grid',gap:8,marginTop:12}}>
              <label>Title <input style={{width:'100%',boxSizing:'border-box'}} maxLength={120} value={override.title??p.title} onChange={e=>patchBuiltin(p.id,{title:e.target.value})}/></label>
              <label>Text <textarea style={{width:'100%',boxSizing:'border-box'}} rows={5} maxLength={3000} value={override.body??p.body} onChange={e=>patchBuiltin(p.id,{body:e.target.value})}/></label>
              <label>Attachment <select style={{width:'100%'}} value={mode} onChange={e=>patchBuiltin(p.id,{mediaMode:e.target.value,mediaId:null})}><option value="original">Keep original media and controls</option><option value="replace" disabled={!media.length}>Replace with uploaded media</option><option value="none">Text only</option></select></label>
              {mode==='replace'&&<label>Replacement media {pick(override.mediaId,id=>patchBuiltin(p.id,{mediaId:id}))}</label>}
              <label>Optional internal link <input style={{width:'100%',boxSizing:'border-box'}} maxLength={300} value={override.link??''} placeholder="/creators" onChange={e=>patchBuiltin(p.id,{link:e.target.value})}/></label>
              <label><input type="checkbox" checked={Boolean(override.hidden)} onChange={e=>patchBuiltin(p.id,{hidden:e.target.checked})}/> Hide this original post</label>
              <button type="button" onClick={()=>resetBuiltin(p.id)}>Restore original post</button>
            </div>
          </details>
        })}
        <button type="button" disabled={!dirty} onClick={save}>Save changes</button>
        <p role="status" aria-live="polite">{message}</p>
      </section>}
      <h3>Posts (newest first)</h3>
      <button type="button" disabled={content.posts.length>=30} onClick={()=>edit(c=>({...c,posts:[{id:crypto.randomUUID(),title:'New post',body:'',mediaId:null,link:'',...(strip?STRIPAGRAM_POST_DEFAULTS:{})},...c.posts]}))}>+ New post</button>
      {content.posts.map(p=><div key={p.id} style={{display:'grid',gap:8,margin:'12px 0',padding:12,border:'1px solid #785879',borderRadius:8}}>
        <label>Title <input style={{width:'100%',boxSizing:'border-box'}} maxLength={120} value={p.title} onChange={e=>patch(p.id,{title:e.target.value})}/></label>
        <label>Text <textarea style={{width:'100%',boxSizing:'border-box'}} rows={4} maxLength={3000} value={p.body} onChange={e=>patch(p.id,{body:e.target.value})}/></label>
        {strip&&<div style={{display:'grid',gap:8}}>
          {[['place','Location',100],['subtitle','Subtitle',160],['mark','Poster symbol',12]].map(([field,label,max])=><label key={field}>{label} <input style={{width:'100%',boxSizing:'border-box'}} maxLength={max} value={p[field]??''} onChange={e=>patch(p.id,{[field]:e.target.value})}/></label>)}
          <label>Category <select value={p.type} onChange={e=>patch(p.id,{type:e.target.value})}><option value="stage">Stage</option><option value="vip">VIP</option><option value="backstage">Backstage</option></select></label>
          <label>Poster color <input type="color" value={p.spot} onChange={e=>patch(p.id,{spot:e.target.value})}/></label>
          <label>Demo applause count <input type="number" min={0} max={1000000} value={p.likes} onChange={e=>patch(p.id,{likes:Number(e.target.value)})}/></label>
        </div>}
        <label>Attachment {pick(p.mediaId,id=>patch(p.id,{mediaId:id}))}</label>
        <label>Internal page link (optional) <input style={{width:'100%',boxSizing:'border-box'}} maxLength={300} placeholder="/creators" value={p.link} onChange={e=>patch(p.id,{link:e.target.value})}/></label>
        <button type="button" onClick={()=>{if(window.confirm('Remove this post? Media will remain in storage.'))edit(c=>({...c,posts:c.posts.filter(x=>x.id!==p.id)}))}}>Remove post</button>
      </div>)}
      <button type="button" disabled={!dirty} onClick={save}>{busy?'Saving…':'Save changes'}</button>
    </fieldset>}
  </section>
}
