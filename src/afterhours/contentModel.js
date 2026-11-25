import { BUILTIN_POSTS, builtinPostIds } from './builtinPosts.js'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const emptyOrbitCards = () => Array(8).fill(null)
export const emptyContent = () => ({ bannerId: null, coverVideoId: null, avatarId: null, profileVideoId: null, orbitCards: emptyOrbitCards(), posts: [], postOverrides: {} })
export function normalizeContent(value, area) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.posts) || value.posts.length > 30) return null
  const id = x => typeof x === 'string' && UUID.test(x)
  const text = (x,max) => typeof x === 'string' && x.length <= max
  if (value.bannerId !== null && !id(value.bannerId)) return null
  const coverVideoId = value.coverVideoId ?? null
  const avatarId = value.avatarId ?? null
  if ([coverVideoId,avatarId].some(x=>x!==null&&!id(x))) return null
  const profileVideoId = value.profileVideoId ?? null
  if (profileVideoId !== null && !id(profileVideoId)) return null
  const orbitCards = value.orbitCards === undefined ? emptyOrbitCards() : value.orbitCards
  if (!Array.isArray(orbitCards) || orbitCards.length !== 8 || !orbitCards.every(x => x === null || x === 'blank' || id(x))) return null
  const seen = new Set()
  const posts = []
  for (const p of value.posts) {
    if (!p || !id(p.id) || seen.has(p.id) || !text(p.title,120) || !p.title.trim() || !text(p.body,3000) ||
        (p.mediaId !== null && !id(p.mediaId)) || !text(p.link,300) ||
        (p.link && !/^\/(?!\/)[a-zA-Z0-9/_-]+$/.test(p.link))) return null
    seen.add(p.id)
    posts.push({id:p.id,title:p.title.trim(),body:p.body,mediaId:p.mediaId,link:p.link})
  }
  const raw=value.postOverrides ?? {}
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return null
  const allowed=new Set(area?builtinPostIds(area):Object.keys(BUILTIN_POSTS).flatMap(builtinPostIds))
  const postOverrides={}
  for(const [key,entry] of Object.entries(raw)){
    if(!allowed.has(key)||!entry||typeof entry!=='object'||Array.isArray(entry))return null
    if(Object.keys(entry).some(k=>!['title','body','mediaMode','mediaId','hidden','link'].includes(k)))return null
    const clean={}
    if(Object.hasOwn(entry,'title')){if(!text(entry.title,120)||!entry.title.trim())return null;clean.title=entry.title.trim()}
    if(Object.hasOwn(entry,'body')){if(!text(entry.body,3000))return null;clean.body=entry.body}
    if(Object.hasOwn(entry,'hidden')){if(typeof entry.hidden!=='boolean')return null;clean.hidden=entry.hidden}
    if(Object.hasOwn(entry,'link')){if(!text(entry.link,300)||(entry.link&&!/^\/(?!\/)[a-zA-Z0-9/_-]+$/.test(entry.link)))return null;clean.link=entry.link}
    if(Object.hasOwn(entry,'mediaMode')){
      if(!['original','replace','none'].includes(entry.mediaMode))return null
      if(entry.mediaMode==='replace'&&!id(entry.mediaId))return null
      if(entry.mediaMode!=='replace'&&entry.mediaId!=null)return null
      clean.mediaMode=entry.mediaMode;clean.mediaId=entry.mediaMode==='replace'?entry.mediaId:null
    }else if(Object.hasOwn(entry,'mediaId'))return null
    if(Object.keys(clean).length)postOverrides[key]=clean
  }
  return {bannerId:value.bannerId,coverVideoId,avatarId,profileVideoId,orbitCards:[...orbitCards],posts,postOverrides}
}
export function contentMediaValid(content, media) {
  const items = new Map(media.map(item => [item.id,item.type]))
  return (!content.bannerId || Boolean(items.get(content.bannerId)?.startsWith('image/'))) &&
    (!content.coverVideoId || ['video/mp4', 'video/webm'].includes(items.get(content.coverVideoId))) &&
    (!content.avatarId || /^(image\/|video\/(mp4|webm)$)/.test(items.get(content.avatarId)||'')) &&
    (!content.profileVideoId || ['video/mp4', 'video/webm'].includes(items.get(content.profileVideoId))) &&
    (content.orbitCards ?? emptyOrbitCards()).every(id => id === null || id === 'blank' || Boolean(items.get(id)?.startsWith('image/'))) &&
    content.posts.every(p => !p.mediaId || /^(image|video)\//.test(items.get(p.mediaId) || '')) &&
    Object.values(content.postOverrides ?? {}).every(p=>p.mediaMode!=='replace'||/^(image|video)\//.test(items.get(p.mediaId)||''))
}
