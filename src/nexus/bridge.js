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

export function restoreBundle(records){
 if(!Array.isArray(records)||records.length<1||records.length>6)throw Error('Select between one and six memories.')
 const result=records.map(restoreRecord)
 if(new Set(result.map(r=>r.id)).size!==result.length)throw Error('Duplicate memory selection.')
 if(new TextEncoder().encode(JSON.stringify(result)).length>48000)throw Error('Selected memories exceed the 48 KB bundle limit. Select fewer records.')
 return result
}
export function acceptBridgeMessage(config,event,opener){
 if(!config||!opener||event.source!==opener||event.origin!==config.origin||event.data?.id!==config.id)return null
 const data=event.data
 if(data.type==='nexus:continuity:hello:v2'&&data.mode===config.mode)return {type:'hello'}
 if(config.mode==='restore'&&data.type==='nexus:continuity:ack:v2'&&typeof data.ok==='boolean'){
  if(data.ok&&typeof data.sessionId==='string'&&bridgeId(data.sessionId)&&Number.isInteger(data.count)&&data.count>=1&&data.count<=6)return {type:'ack',ok:true,sessionId:data.sessionId,count:data.count}
  if(!data.ok)return {type:'ack',ok:false}
 }
 if(config.mode==='save'){const draft=acceptDraft(config,event,opener);if(draft)return {type:'draft',draft}}
 return null
}
