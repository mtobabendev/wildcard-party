import { createCipheriv, createDecipheriv, randomBytes, createHmac } from 'node:crypto'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const ACCOUNT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
import { validateMegaSeed, FIELDS, SOURCES } from '../src/nexus/megaseed.js'
export { SOURCES }
export const PAGE_SIZE = 20
export function memoryKey(env) {
  const value = env.NEXUS_MEMORY_KEY
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(value)) return null
  const bytes = Buffer.from(value, 'base64')
  return bytes.length === 32 && bytes.toString('base64') === value ? bytes : null
}
export function memoryReady(env) {
  return env.VERCEL_ENV === 'production' && env.NEXUS_MEMORY_ENABLED === '1' &&
    typeof env.NEXUS_MEMORY_DATABASE_URL === 'string' && Boolean(env.NEXUS_MEMORY_DATABASE_URL) && Boolean(memoryKey(env))
}
export function parsePacket(body) {
  const fields = ['requestId','source','title','state','context','memory','nextStep']
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== fields.length ||
      Object.keys(body).some(k => !fields.includes(k)) || !UUID.test(body.requestId || '') || !SOURCES.includes(body.source)) throw Error('Invalid capture.')
  const p = { requestId: body.requestId.toLowerCase(), source: body.source }
  Object.assign(p,validateMegaSeed(Object.fromEntries(FIELDS.map(([field])=>[field,body[field]]))))
  if(Buffer.byteLength(JSON.stringify(p),'utf8')>24000)throw Error('Capture exceeds storage size.')
  return p
}
function aad(account, requestId) {
  if (!ACCOUNT.test(account) || !UUID.test(requestId)) throw Error('Invalid scope.')
  return Buffer.from('nexus-memory-v1:'+account.toLowerCase()+':'+requestId.toLowerCase())
}
export function encryptPacket(packet, account, key) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm',key,iv)
  cipher.setAAD(aad(account,packet.requestId))
  const ct = Buffer.concat([cipher.update(JSON.stringify(packet),'utf8'),cipher.final()])
  return ['v1',iv.toString('base64'),cipher.getAuthTag().toString('base64'),ct.toString('base64')].join('.')
}
export function decryptPacket(envelope, account, requestId, key) {
  if (typeof envelope !== 'string' || envelope.length > 40000) throw Error('Invalid encrypted record.')
  const [version,iv,tag,ct,...rest] = envelope.split('.')
  if (version !== 'v1' || rest.length || !iv || !tag || !ct || Buffer.from(iv,'base64').length !== 12 || Buffer.from(tag,'base64').length !== 16) throw Error('Invalid encrypted record.')
  const decipher = createDecipheriv('aes-256-gcm',key,Buffer.from(iv,'base64'))
  decipher.setAAD(aad(account,requestId))
  decipher.setAuthTag(Buffer.from(tag,'base64'))
  const p = parsePacket(JSON.parse(Buffer.concat([decipher.update(Buffer.from(ct,'base64')),decipher.final()]).toString('utf8')))
  if (p.requestId !== requestId.toLowerCase()) throw Error('Invalid record scope.')
  return p
}
export function cursorValid(v) { return typeof v === 'string' && /^[1-9][0-9]{0,18}$/.test(v) && BigInt(v) <= 9223372036854775807n }

// HMAC, not a public content hash: only this account and key can compare packets.
export function packetDigest(packet,account,key){
 if(!ACCOUNT.test(account))throw Error('Invalid account scope.')
 const content=Object.fromEntries(FIELDS.map(([f])=>[f,packet[f]]))
 return createHmac('sha256',key).update('nexus-megaseed-v1\0'+account.toLowerCase()+'\0'+JSON.stringify(content)).digest('hex')
}
