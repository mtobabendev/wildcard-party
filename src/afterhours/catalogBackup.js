import {normalizeContent,contentMediaValid} from './contentModel.js'
import {normalizeStripagram} from './stripagramModel.js'
export const CATALOG_AREAS=['penny','kandy','ashley']
export const CATALOG_SURFACES=['afterhours','stripagram']
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const normalize=(surface,content)=>surface==='stripagram'?normalizeStripagram(content):normalizeContent(content)
function mediaList(value){
 if(!Array.isArray(value)||value.length>1000)throw Error('Invalid media inventory.')
 const ids=new Set()
 return value.map(m=>{
  if(!m||typeof m.id!=='string'||!uuid.test(m.id)||ids.has(m.id)||typeof m.name!=='string'||!m.name||m.name.length>180||typeof m.type!=='string'||! /^(image\/(jpeg|png|webp|gif)|video\/(mp4|webm))$/.test(m.type))throw Error('Invalid or duplicate inventory entry.')
  ids.add(m.id)
  return {id:m.id,name:m.name,type:m.type}
 })
}
export function parseCatalog(value){
 if(!value||value.format!=='wildcard-catalog'||value.version!==1||!Array.isArray(value.pages)||value.pages.length!==6)throw Error('Expected a version 1 catalog containing six pages.')
 const seen=new Set()
 const pages=value.pages.map(page=>{
  if(!page||!CATALOG_AREAS.includes(page.area)||!CATALOG_SURFACES.includes(page.surface))throw Error('Invalid catalog page.')
  const key=page.area+'/'+page.surface
  if(seen.has(key))throw Error('Duplicate catalog page.')
  seen.add(key)
  const content=normalize(page.surface,page.content)
  if(!content)throw Error('Invalid layout for '+key)
  const media=mediaList(page.media)
  if(!contentMediaValid(content,media))throw Error('Backup has unresolved media references for '+key+'.')
  return {area:page.area,surface:page.surface,content,media}
 })
 return {format:'wildcard-catalog',version:1,pages}
}
export const createCatalog=pages=>parseCatalog({format:'wildcard-catalog',version:1,pages})
export function restoreDraft(catalog,area,surface,currentMedia){
 const page=parseCatalog(catalog).pages.find(p=>p.area===area&&p.surface===surface)
 if(!page)throw Error('Page not found in catalog.')
 const current=mediaList(currentMedia)
 const old=new Map(page.media.map(m=>[m.id,m]))
 const failures=new Set()
 function bind(id){
  if(id===null||id==='blank')return id
  const item=old.get(id)
  if(!item){failures.add('Unknown reference '+id);return id}
  const matches=current.filter(m=>m.name===item.name&&m.type===item.type)
  const exact=matches.find(m=>m.id===id)
  if(exact)return exact.id
  if(matches.length===1)return matches[0].id
  failures.add(item.name+(matches.length?' (ambiguous filename)':' (missing)'))
  return id
 }
 const draft={...page.content}
 for(const name of ['bannerId','coverVideoId','avatarId','profileVideoId'])draft[name]=bind(draft[name])
 draft.orbitCards=draft.orbitCards.map(bind)
 draft.posts=draft.posts.map(p=>({...p,mediaId:bind(p.mediaId)}))
 if(failures.size)throw Error('Resolve media before restoring: '+[...failures].join('; '))
 const checked=normalize(surface,draft)
 if(!checked||!contentMediaValid(checked,current))throw Error('Restored draft failed validation.')
 return checked
}
