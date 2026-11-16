// A one-shot, browser-mediated Owner bridge. No tokens, cross-origin API, or URL payloads.
import {validateMegaSeed,FIELDS,SOURCES} from './megaseed.js'
export const BRIDGE_ORIGINS=['http://127.0.0.1:5173','http://localhost:5173']
export const bridgeId=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)
export function bridgeConfig(search){
 const q=new URLSearchParams(search),mode=q.get('bridge'),origin=q.get('local'),id=q.get('id')
 if(!['save','restore'].includes(mode)||!BRIDGE_ORIGINS.includes(origin)||!bridgeId(id)||[...q.keys()].length!==3)return null
 return {mode,origin,id}
}
export function acceptDraft(config,event,opener){
 if(!config||config.mode!=='save'||!opener||event.source!==opener||event.origin!==config.origin)return null
 const d=event.data
 if(!d||d.type!=='nexus:continuity:draft:v1'||d.id!==config.id||!SOURCES.includes(d.source))return null
 return {source:d.source,...validateMegaSeed(d.packet)}
}
export function restoreRecord(r){
 if(!r||typeof r.id!=='string'||!/^[1-9][0-9]{0,18}$/.test(r.id)||!SOURCES.includes(r.source)||!Array.isArray(r.sources)||!r.sources.includes(r.source)||r.sources.some(s=>!SOURCES.includes(s))||Number.isNaN(new Date(r.createdAt).valueOf()))throw Error('Invalid memory receipt.')
 return {id:r.id,source:r.source,sources:[...r.sources],createdAt:new Date(r.createdAt).toISOString(),...validateMegaSeed(Object.fromEntries(FIELDS.map(([f])=>[f,r[f]])))}
}
