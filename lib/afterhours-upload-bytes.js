// Bounded JSON transport stays below Vercel's 4.5 MB request limit.
export const RELAY_MAX_BYTES = 2 * 1024 * 1024

export function decodeRelayBytes(encoded, expectedSize) {
  if (!Number.isSafeInteger(expectedSize) || expectedSize < 1 || expectedSize > RELAY_MAX_BYTES ||
      typeof encoded !== 'string' || encoded.length !== 4 * Math.ceil(expectedSize / 3) ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return null
  const bytes = Buffer.from(encoded, 'base64')
  if (bytes.length !== expectedSize || bytes.toString('base64') !== encoded) return null
  return bytes
}
