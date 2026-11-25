import { randomUUID } from 'node:crypto'
import { databaseSql } from './database-sql.js'
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { ensureMediaSchema, finishPrivateUpload, startPrivateUpload } from './afterhours-media.js'
import { LEGACY_PENNY_ASSETS, legacyPennyAsset } from './afterhours-legacy-catalog.js'

const MAX_BYTES = 150 * 1024 * 1024
const ALLOWED_ORIGINS = new Set(['https://wildcarddev.com', 'https://www.wildcarddev.com'])

function bucketConnection() {
  const { AWS_ENDPOINT_URL_S3: endpoint, AWS_ACCESS_KEY_ID: accessKeyId,
    AWS_SECRET_ACCESS_KEY: secretAccessKey, AWS_REGION: region,
    NEON_STORAGE_BUCKET: bucket } = process.env
  if (!endpoint || !accessKeyId || !secretAccessKey || !region || !bucket) {
    const error = new Error('Private media storage not configured.')
    error.code = 'STORAGE_NOT_CONFIGURED'
    throw error
  }
  const url = new URL(endpoint)
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('Invalid storage endpoint.')
  }
  return {
    endpoint: url, bucket,
    client: new S3Client({ endpoint, region, forcePathStyle: true,
      credentials: { accessKeyId, secretAccessKey } }),
  }
}

// Checks an actual anonymous GET against a harmless private-storage canary.
// A public bucket, unknown response, or failed cleanup blocks migration.
export async function verifyProductionBucketPrivate() {
  const { client, bucket, endpoint } = bucketConnection()
  const key = 'afterhours/_privacy-probe/' + randomUUID() + '.txt'
  await client.send(new PutObjectCommand({
    Bucket: bucket, Key: key,
    Body: Buffer.from('WildCard private storage probe'), ContentType: 'text/plain',
  }))
  let privateResult = false
  try {
    const anonymous = new URL(endpoint)
    anonymous.pathname = endpoint.pathname.replace(/\/$/, '') + '/' + encodeURIComponent(bucket) + '/' +
      key.split('/').map(encodeURIComponent).join('/')
    const response = await fetch(anonymous, {
      method: 'GET', redirect: 'manual', cache: 'no-store',
      signal: AbortSignal.timeout(10000),
    })
    await response.body?.cancel()
    privateResult = response.status === 403
  } finally {
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
  }
  return privateResult
}

async function downloadAllowedSource(asset) {
  let url = new URL(asset.path, 'https://wildcarddev.com')
  let response
  for (let hop = 0; hop < 3; hop++) {
    if (!ALLOWED_ORIGINS.has(url.origin) || url.pathname !== asset.path ||
        url.search || url.hash || url.username || url.password) {
      throw new Error('Legacy media source URL was rejected.')
    }
    response = await fetch(url, {
      method: 'GET', redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(45000),
    })
    if ([301, 302, 307, 308].includes(response.status) && response.headers.get('location')) {
      const next = new URL(response.headers.get('location'), url)
      await response.body?.cancel()
      url = next
      continue
    }
    break
  }
  if (!response || response.status !== 200 || !response.body) {
    await response?.body?.cancel()
    throw new Error('Legacy file could not be retrieved.')
  }
  const announced = Number(response.headers.get('content-length') || 0)
  if (!Number.isSafeInteger(announced) || announced > MAX_BYTES) {
    await response.body.cancel()
    throw new Error('Legacy media size exceeded the limit.')
  }
  let length = 0
  const chunks = []
  for await (const piece of response.body) {
    length += piece.byteLength
    if (length > MAX_BYTES) throw new Error('Legacy media size exceeded the limit.')
    chunks.push(Buffer.from(piece))
  }
  const bytes = Buffer.concat(chunks)
  const jpg = asset.type === 'image/jpeg' && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
  const webp = asset.type === 'image/webp' && bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, 12) === 'WEBP'
  const webm = asset.type === 'video/webm' && bytes.subarray(0, 4).equals(Buffer.from([26, 69, 223, 163]))
  const mp4 = asset.type === 'video/mp4' && bytes.toString('ascii', 4, 8) === 'ftyp'
  if (!length || !(jpg || webp || webm || mp4)) {
    throw new Error('Legacy file did not match its expected media signature.')
  }
  return bytes
}

export async function legacyImportStatus() {
  await ensureMediaSchema()
  if (!process.env.DATABASE_URL) throw new Error('Database not configured.')
  const sql = databaseSql(process.env.DATABASE_URL)
  const ready = await sql`
    SELECT display_name FROM wildcard_afterhours_media WHERE area = 'penny' AND state = 'ready'
  `
  const names = new Set(ready.map(row => row.display_name))
  const missing = LEGACY_PENNY_ASSETS.filter(item => !names.has(item.name)).map(item => item.name)
  return { total: LEGACY_PENNY_ASSETS.length, ready: LEGACY_PENNY_ASSETS.length - missing.length, missing }
}

export async function importAllowedLegacyPenny(name, ownerId) {
  const item = legacyPennyAsset(name)
  if (!item) return null
  const before = await legacyImportStatus()
  if (!before.missing.includes(name)) return { name, state: 'already-ready' }
  if (!(await verifyProductionBucketPrivate())) {
    const error = new Error('Bucket privacy verification failed.')
    error.code = 'BUCKET_NOT_PRIVATE'
    throw error
  }
  const bytes = await downloadAllowedSource(item)
  const ticket = await startPrivateUpload({
    ownerId, area: 'penny', name: item.name, type: item.type, size: bytes.length,
  })
  if (!ticket) throw new Error('Could not create the private upload ticket.')
  const upload = await fetch(ticket.uploadUrl, {
    method: 'PUT', headers: { 'Content-Type': ticket.contentType }, body: bytes,
    redirect: 'error', signal: AbortSignal.timeout(45000),
  })
  await upload.body?.cancel()
  if (!upload.ok) throw new Error('Private storage rejected the upload.')
  if (!(await finishPrivateUpload(ownerId, ticket.id))) {
    throw new Error('Private storage verification failed.')
  }
  return { name, state: 'ready', bytes: bytes.length }
}
