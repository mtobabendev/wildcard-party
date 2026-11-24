import { randomUUID } from 'node:crypto'
import { neon } from '@neondatabase/serverless'
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { sanitizeAttachmentName } from './comms-storage.js'
import { validCollectionLabel } from '../src/afterhours/mediaCollections.js'
import { ensureAfterHoursSchema, validAccountId, validArea } from './afterhours-access.js'

const MAX_BYTES = 150 * 1024 * 1024
const TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/webm'])
let schemaPromise
let storageClient

function sqlClient() {
  if (!process.env.DATABASE_URL) {
    const error = new Error('Database is not configured.')
    error.code = 'DATABASE_NOT_CONFIGURED'
    throw error
  }
  return neon(process.env.DATABASE_URL)
}

function storage() {
  const { AWS_ENDPOINT_URL_S3: endpoint, AWS_ACCESS_KEY_ID: accessKeyId,
    AWS_SECRET_ACCESS_KEY: secretAccessKey, AWS_REGION: region,
    NEON_STORAGE_BUCKET: bucket } = process.env
  if (!endpoint || !accessKeyId || !secretAccessKey || !region || !bucket) {
    const error = new Error('Private storage is not configured.')
    error.code = 'STORAGE_NOT_CONFIGURED'
    throw error
  }
  if (!storageClient) {
    storageClient = new S3Client({
      endpoint, region, forcePathStyle: true,
      credentials: { accessKeyId, secretAccessKey },
    })
  }
  return { client: storageClient, bucket }
}

export function validMediaType(value) {
  return typeof value === 'string' && TYPES.has(value.toLowerCase()) ? value.toLowerCase() : ''
}

export function validMediaSize(value) {
  return Number.isSafeInteger(value) && value >= 1 && value <= MAX_BYTES
}

export async function ensureMediaSchema() {
  await ensureAfterHoursSchema()
  if (!schemaPromise) {
    schemaPromise = (async () => {
      const sql = sqlClient()
      await sql`
        CREATE TABLE IF NOT EXISTS wildcard_afterhours_media (
          id uuid PRIMARY KEY,
          area varchar(16) NOT NULL CHECK (area IN ('penny','kandy','ashley')),
          storage_key text NOT NULL UNIQUE,
          display_name varchar(180) NOT NULL,
          content_type varchar(80) NOT NULL,
          byte_size bigint NOT NULL,
          uploaded_by uuid NOT NULL REFERENCES wildcard_accounts(id),
          state varchar(12) NOT NULL DEFAULT 'pending'
            CHECK (state IN ('pending','ready')),
          created_at timestamptz NOT NULL DEFAULT now()
        )
      `
      await sql`
        ALTER TABLE wildcard_afterhours_media
        ADD COLUMN IF NOT EXISTS collection_override varchar(48)
      `
      await sql`
        CREATE INDEX IF NOT EXISTS wildcard_afterhours_media_area_idx
        ON wildcard_afterhours_media (area, state, created_at DESC)
      `
    })().catch(error => { schemaPromise = null; throw error })
  }
  return schemaPromise
}

export async function startPrivateUpload({ ownerId, area, name, type, size }) {
  const actor = validAccountId(ownerId)
  const requested = validArea(area)
  const mime = validMediaType(type)
  if (!actor || !requested || !mime || !validMediaSize(size)) return null
  await ensureMediaSchema()
  const { client, bucket } = storage()
  const id = randomUUID()
  const safeName = sanitizeAttachmentName(name)
  const key = `afterhours/${requested}/${id}-${safeName}`
  const uploadUrl = await getSignedUrl(client,
    new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: mime }),
    { expiresIn: 60, signableHeaders: new Set(['content-type']) })

  const sql = sqlClient()
  await sql`
    INSERT INTO wildcard_afterhours_media
      (id, area, storage_key, display_name, content_type, byte_size, uploaded_by)
    VALUES
      (${id}::uuid, ${requested}, ${key}, ${safeName}, ${mime}, ${size}, ${actor}::uuid)
  `
  return { id, uploadUrl, expiresIn: 60, contentType: mime }
}

export async function finishPrivateUpload(ownerId, mediaId) {
  const actor = validAccountId(ownerId)
  const id = validAccountId(mediaId)
  if (!actor || !id) return false
  await ensureMediaSchema()
  const sql = sqlClient()
  const [row] = await sql`
    SELECT id, storage_key, content_type, byte_size
    FROM wildcard_afterhours_media
    WHERE id = ${id}::uuid AND uploaded_by = ${actor}::uuid AND state = 'pending'
    LIMIT 1
  `
  if (!row) return false
  const { client, bucket } = storage()
  const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: row.storage_key }))
  if (Number(head.ContentLength) !== Number(row.byte_size) ||
      String(head.ContentType || '').toLowerCase() !== row.content_type) {
    return false
  }
  const updated = await sql`
    UPDATE wildcard_afterhours_media SET state = 'ready'
    WHERE id = ${id}::uuid AND uploaded_by = ${actor}::uuid AND state = 'pending'
    RETURNING id
  `
  return updated.length === 1
}

export async function listPrivateMedia(area) {
  const requested = validArea(area)
  if (!requested) return []
  await ensureMediaSchema()
  const sql = sqlClient()
  const rows = await sql`
    SELECT id, display_name, content_type, byte_size, collection_override
    FROM wildcard_afterhours_media
    WHERE area = ${requested} AND state = 'ready'
    ORDER BY created_at DESC
    LIMIT 100
  `
  return rows.map(row => ({
    id: row.id, name: row.display_name,
    type: row.content_type, size: Number(row.byte_size), collection: row.collection_override,
  }))
}

export async function privateMediaDownload(mediaId) {
  const id = validAccountId(mediaId)
  if (!id) return null
  await ensureMediaSchema()
  const sql = sqlClient()
  const [row] = await sql`
    SELECT id, area, storage_key, display_name, content_type
    FROM wildcard_afterhours_media
    WHERE id = ${id}::uuid AND state = 'ready' LIMIT 1
  `
  if (!row) return null
  return row
}

export async function privateMediaByName(area, name) {
  const requested = validArea(area)
  if (!requested || typeof name !== 'string' || name.length > 180 ||
      name.includes('/') || name.includes('\\') ||
      sanitizeAttachmentName(name) !== name) return null
  await ensureMediaSchema()
  const sql = sqlClient()
  const [row] = await sql`
    SELECT id, area, storage_key, display_name, content_type
    FROM wildcard_afterhours_media
    WHERE area = ${requested} AND display_name = ${name} AND state = 'ready'
    ORDER BY created_at DESC
    LIMIT 1
  `
  return row || null
}

export async function signedPrivateMediaUrl(row) {
  const { client, bucket } = storage()
  const command = new GetObjectCommand({
    Bucket: bucket, Key: row.storage_key,
    ResponseContentType: row.content_type,
    ResponseContentDisposition: "inline; filename*=UTF-8''" + encodeURIComponent(row.display_name),
    ResponseCacheControl: 'private, no-store',
  })
  // Video players may request additional byte ranges after playback begins.
  // New requests still require an active Messenger session and area grant.
  const expiresIn = row.content_type?.startsWith('video/') ? 900 : 120
  return getSignedUrl(client, command, { expiresIn })
}

 // Remove the exact catalog record. Retain the private object for recovery;
 // without a ready record the media endpoint cannot issue new signed URLs.
export async function removePrivateMedia({ area, id, name }) {
  const requested = validArea(area)
  const mediaId = validAccountId(id)
  if (!requested || !mediaId || typeof name !== 'string' || !name) return false
  await ensureMediaSchema()
  const sql = sqlClient()
  const rows = await sql`
    DELETE FROM wildcard_afterhours_media
    WHERE id = ${mediaId}::uuid AND area = ${requested}
      AND display_name = ${name} AND state = 'ready'
    RETURNING id
  `
  return rows.length === 1
}

 // Move only the gallery assignment; existing file names, IDs and object keys stay intact.
export async function movePrivateMedia({ area, id, name, collection }) {
  const requested = validArea(area)
  const mediaId = validAccountId(id)
  if (!requested || !mediaId || typeof name !== 'string' || !name || !validCollectionLabel(collection)) return false
  await ensureMediaSchema()
  const sql = sqlClient()
  const rows = await sql`
    UPDATE wildcard_afterhours_media
    SET collection_override = ${collection}
    WHERE id = ${mediaId}::uuid AND area = ${requested}
      AND display_name = ${name} AND state = 'ready'
    RETURNING id
  `
  return rows.length === 1
}
