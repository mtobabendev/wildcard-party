const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const emptyContent = () => ({ bannerId: null, posts: [] })
export function normalizeContent(value) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.posts) || value.posts.length > 30) return null
  const id = x => typeof x === 'string' && UUID.test(x)
  const text = (x,max) => typeof x === 'string' && x.length <= max
  if (value.bannerId !== null && !id(value.bannerId)) return null
  const seen = new Set()
  const posts = []
  for (const p of value.posts) {
    if (!p || !id(p.id) || seen.has(p.id) || !text(p.title,120) || !p.title.trim() || !text(p.body,3000) ||
        (p.mediaId !== null && !id(p.mediaId)) || !text(p.link,300) ||
        (p.link && !/^\/(?!\/)[a-zA-Z0-9/_-]+$/.test(p.link))) return null
    seen.add(p.id)
    posts.push({id:p.id,title:p.title.trim(),body:p.body,mediaId:p.mediaId,link:p.link})
  }
  return {bannerId:value.bannerId,posts}
}
export function contentMediaValid(content, media) {
  const items = new Map(media.map(item => [item.id,item.type]))
  return (!content.bannerId || items.get(content.bannerId)?.startsWith('image/')) &&
    content.posts.every(p => !p.mediaId || /^(image|video)\//.test(items.get(p.mediaId) || ''))
}
