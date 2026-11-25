const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const emptyOrbitCards = () => Array(8).fill(null)
export const emptyContent = () => ({ bannerId: null, coverVideoId: null, avatarId: null, profileVideoId: null, orbitCards: emptyOrbitCards(), posts: [] })
export function normalizeContent(value) {
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
  return {bannerId:value.bannerId,coverVideoId,avatarId,profileVideoId,orbitCards:[...orbitCards],posts}
}
export function contentMediaValid(content, media) {
  const items = new Map(media.map(item => [item.id,item.type]))
  return (!content.bannerId || Boolean(items.get(content.bannerId)?.startsWith('image/'))) &&
    (!content.coverVideoId || ['video/mp4', 'video/webm'].includes(items.get(content.coverVideoId))) &&
    (!content.avatarId || /^(image\/|video\/(mp4|webm)$)/.test(items.get(content.avatarId)||'')) &&
    (!content.profileVideoId || ['video/mp4', 'video/webm'].includes(items.get(content.profileVideoId))) &&
    (content.orbitCards ?? emptyOrbitCards()).every(id => id === null || id === 'blank' || Boolean(items.get(id)?.startsWith('image/'))) &&
    content.posts.every(p => !p.mediaId || /^(image|video)\//.test(items.get(p.mediaId) || ''))
}
