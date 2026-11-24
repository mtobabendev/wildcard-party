import { useEffect, useState } from 'react'
import { emptyContent } from './contentModel.js'
const AREAS=['penny','kandy','ashley']
const api=(area)=>'/api/afterhours/creator-content?area='+area
export default function OwnerContentEditor({ mediaRevision = 0 }) {
  const [area,setArea]=useState('penny')
  const [content,setContent]=useState(emptyContent)
  const [media,setMedia]=useState([])
  const [revision,setRevision]=useState(0)
  const [ready,setReady]=useState(false)
  const [busy,setBusy]=useState(false)
  const [dirty,setDirty]=useState(false)
  const [message,setMessage]=useState('')
  const [reload,setReload]=useState(0)
  const [mediaRefresh,setMediaRefresh]=useState(0)
  const [mediaStatus,setMediaStatus]=useState('')
  const refreshMedia=()=>setMediaRefresh(v=>v+1)
  useEffect(()=>{
    let active=true
    setReady(false);setDirty(false);setMedia([]);setMediaStatus('');setMessage('Loading creator content…')
    fetch(api(area),{credentials:'same-origin',cache:'no-store'}).then(async r=>{
      const d=await r.json();if(!r.ok)throw Error(d.error||'Load failed')
      if(active){setContent({...emptyContent(),...d.content});setMedia(d.media);setRevision(d.revision);setReady(true);setMessage('')}
    }).catch(e=>{if(active)setMessage(e.message)})
    return ()=>{active=false}
  },[area,reload])
  // Refresh only the catalog; never replace an unsaved content draft or revision.
  useEffect(()=>{
    if(!ready)return
    const controller=new AbortController()
    setMediaStatus('Refreshing media…')
    fetch('/api/afterhours/media?area='+encodeURIComponent(area),{credentials:'same-origin',cache:'no-store',signal:controller.signal})
      .then(async r=>{const d=await r.json();if(!r.ok||!Array.isArray(d.media))throw Error(d.error||'Media refresh failed');return d.media})
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
  function patch(id,change){edit(c=>({...c,posts:c.posts.map(p=>p.id===id?{...p,...change}:p)}))}
  async function save(){
    setBusy(true);setMessage('Saving…')
    try{
      const r=await fetch(api(area),{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision,content})})
      const d=await r.json();if(!r.ok)throw Error(d.error||'Save failed')
      setContent(d.content);setRevision(d.revision);setDirty(false);setMessage('Saved. Refresh the creator page to see changes.')
    }catch(e){setMessage(e.message)}finally{setBusy(false)}
  }
  const switchArea=e=>{if(!dirty||window.confirm('Discard unsaved edits?'))setArea(e.target.value)}
  const pick=(value,onChange,kind='all')=><select value={value||''} onChange={e=>onChange(e.target.value||null)} disabled={busy} style={{maxWidth:'100%',width:'100%'}}>
    <option value="">None / default</option>{media.filter(m=>kind==='all'||(kind==='image'&&m.type.startsWith('image/'))||(kind==='video'&&['video/mp4','video/webm'].includes(m.type))).map(m=><option key={m.id} value={m.id}>{m.name}</option>)}
    {value&&!media.some(m=>m.id===value)&&<option value={value}>Unavailable — choose another</option>}
  </select>
  return <section style={{maxWidth:920,margin:'16px auto',padding:16,border:'1px solid #99688f',borderRadius:16,background:'#22152c',color:'#fff'}}>
    <h2>Creator content manager</h2><p>Manage page content for each creator. Existing member permissions remain in force.</p>
    <label>Creator <select value={area} onChange={switchArea} disabled={busy}>{AREAS.map(a=><option key={a}>{a}</option>)}</select></label>{' '}
    <button type="button" disabled={busy||!ready} onClick={refreshMedia}>Refresh media</button>{' '}
    <button type="button" disabled={busy} onClick={()=>{if(!dirty||window.confirm('Discard unsaved edits?'))setReload(v=>v+1)}}>Reload content</button>
    <p role="status" aria-live="polite">{mediaStatus}</p>
    <p><a href={'/afterhours-members.html?area='+area} target="_blank" rel="noopener noreferrer">Manage collections (move or remove)</a>{' · '}<a href={'https://www.wildcarddev.com/'+area+'/after-hours'} target="_blank" rel="noopener noreferrer">Open creator page</a></p>
    <p role="status">{message}</p>
    {ready&&<fieldset disabled={busy} style={{border:0,padding:0,minWidth:0}}>
      <h3>Profile banner</h3><label>Choose an existing image {pick(content.bannerId,id=>edit(c=>({...c,bannerId:id})),'image')}</label>
      {area==='penny'&&<section id="profile-video" aria-labelledby="profile-video-title" style={{scrollMarginTop:16,margin:'18px 0'}}>
        <h3 id="profile-video-title">Profile video</h3>
        <p>Optional video beneath the Profile heading. Choose None / default to hide the player.</p>
        <label>Video {pick(content.profileVideoId,id=>edit(c=>({...c,profileVideoId:id})),'video')}</label>
      </section>}
      <h3>Posts (newest first)</h3>
      <button type="button" disabled={content.posts.length>=30} onClick={()=>edit(c=>({...c,posts:[{id:crypto.randomUUID(),title:'New post',body:'',mediaId:null,link:''},...c.posts]}))}>+ New post</button>
      {content.posts.map(p=><div key={p.id} style={{display:'grid',gap:8,margin:'12px 0',padding:12,border:'1px solid #785879',borderRadius:8}}>
        <label>Title <input style={{width:'100%',boxSizing:'border-box'}} maxLength={120} value={p.title} onChange={e=>patch(p.id,{title:e.target.value})}/></label>
        <label>Text <textarea style={{width:'100%',boxSizing:'border-box'}} rows={4} maxLength={3000} value={p.body} onChange={e=>patch(p.id,{body:e.target.value})}/></label>
        <label>Attachment {pick(p.mediaId,id=>patch(p.id,{mediaId:id}))}</label>
        <label>Internal page link (optional) <input style={{width:'100%',boxSizing:'border-box'}} maxLength={300} placeholder="/creators" value={p.link} onChange={e=>patch(p.id,{link:e.target.value})}/></label>
        <button type="button" onClick={()=>{if(window.confirm('Remove this post? Media will remain in storage.'))edit(c=>({...c,posts:c.posts.filter(x=>x.id!==p.id)}))}}>Remove post</button>
      </div>)}
      <button type="button" disabled={!dirty} onClick={save}>{busy?'Saving…':'Save changes'}</button>
    </fieldset>}
  </section>
}
