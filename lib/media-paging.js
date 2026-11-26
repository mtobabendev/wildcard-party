// All media pages share the existing Messenger session and Owner area grants.
// Only a bounded 100-record batch is returned per server request.
export const MEDIA_PAGE_SIZE = 100
export const MAX_MEDIA_PAGES = 100

export function parseMediaPage(value) {
  if (value === undefined) return 0
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,1})$/.test(value)) return null
  const number = Number(value)
  return number < MAX_MEDIA_PAGES ? number : null
}

export function nextMediaPage(page, count) {
  return count === MEDIA_PAGE_SIZE ? page + 1 : null
}
