export const EMBED_ORIGINS = Object.freeze([
  'https://wildcarddev.com',
  'https://www.wildcarddev.com',
  'https://party.wildcarddev.com',
  'https://labs.wildcarddev.com',
  'https://pennysoffice.wildcarddev.com',
  'https://pennytv.wildcarddev.com',
])
export const BRIDGE = 'wildcard:messenger:v1:'
export function parentOrigin(value) {
  return EMBED_ORIGINS.includes(value) ? value : null
}
export function validParentEvent(event, origin, parent) {
  return Boolean(origin && event.origin === origin && event.source === parent &&
    event.data?.type === BRIDGE + 'state' &&
    typeof event.data.open === 'boolean' && typeof event.data.visible === 'boolean')
}
export function unreadCount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null
}
