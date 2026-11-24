// Collection labels are stored in the existing private media display_name.
// No new public asset path, database table, or auth route is required.
const PREFIX = 'wc-vault__'
const ARCHIVE = 'Private Archive'
const MAX_NAME = 180

export function createCollectionName(filename, collection) {
  const original = typeof filename === 'string'
    ? filename.split(/[\\/]/).pop().replace(/[\u0000-\u001f\u007f]/g, '').trim()
    : ''
  if (!original) return ''
  const label = typeof collection === 'string'
    ? collection.replace(/[\\/]/g, ' ').replace(/[^a-zA-Z0-9 _-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 48).trim()
    : ''
  if (!label) return original.slice(0, MAX_NAME)
  const remaining = MAX_NAME - PREFIX.length - label.length - 2
  return PREFIX + label + '__' + original.slice(0, Math.max(1, remaining))
}

export function validCollectionLabel(value) {
  return typeof value === 'string' && /^[a-zA-Z0-9 _-]{1,48}$/.test(value)
    && value.trim() === value && /[a-zA-Z0-9]/.test(value)
}

export function describePrivateMedia(item) {
  const name = typeof item?.name === 'string' ? item.name : ''
  const marker = name.startsWith(PREFIX) ? name.slice(PREFIX.length) : ''
  const separator = marker.indexOf('__')
  const label = separator > 0 ? marker.slice(0, separator) : ''
  const file = separator > 0 ? marker.slice(separator + 2) : name
  const valid = /^[a-zA-Z0-9 _-]{1,48}$/.test(label) && Boolean(file)
  const collection = validCollectionLabel(item?.collection) ? item.collection : valid ? label : ARCHIVE
  const displayName = valid ? file : name
  const title = displayName.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() || 'Untitled'
  return { ...item, collection, displayName, title }
}

export function groupPrivateMedia(media, type) {
  if (!Array.isArray(media)) return []
  const groups = new Map()
  for (const raw of media) {
    if (!raw || typeof raw.id !== 'string' || typeof raw.type !== 'string') continue
    if (type === 'reels' ? !raw.type.startsWith('video/') : !raw.type.startsWith('image/') && !raw.type.startsWith('video/')) continue
    const item = describePrivateMedia(raw)
    if (!groups.has(item.collection)) groups.set(item.collection, [])
    groups.get(item.collection).push(item)
  }
  return [...groups].map(([name, items]) => ({ name, items }))
}
