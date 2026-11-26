// Load the full private catalog through bounded, access-checked pages.
// This does not fetch media bytes, only records needed for galleries and music.
import { MAX_MEDIA_PAGES } from '../../lib/media-paging.js'

export async function fetchPrivateMediaPages(area, { signal, fetcher = fetch } = {}) {
  if (!['penny', 'kandy', 'ashley'].includes(area)) throw new Error('Invalid private media area.')
  const result = []
  const seen = new Set()
  let page = 0
  for (let index = 0; index < MAX_MEDIA_PAGES; index++) {
    const response = await fetcher('/api/afterhours/media?area=' + encodeURIComponent(area) +
      '&page=' + page, { credentials: 'same-origin', cache: 'no-store', signal })
    const json = await response.json()
    if (!response.ok || !Array.isArray(json.media)) {
      throw new Error(json.error || 'Private media catalog unavailable.')
    }
    for (const item of json.media) {
      if (!item || typeof item.id !== 'string' || seen.has(item.id)) continue
      seen.add(item.id)
      result.push(item)
    }
    if (json.nextPage == null) return result
    if (!Number.isInteger(json.nextPage) || json.nextPage !== page + 1) {
      throw new Error('Invalid media page response.')
    }
    page = json.nextPage
  }
  throw new Error('Private media catalog exceeds the supported page limit.')
}
