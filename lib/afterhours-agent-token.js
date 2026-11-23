// Upload-only pairing for Owner workstation. Reuses wildcard_sessions;
// prefix cannot collide with the regular hex-only browser session hashes.
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { neon } from '@neondatabase/serverless'
import { ensureIdentitySchema } from './auth-db.js'

const DAYS = 90
const PREFIX = 'wcu1_'
const ROW_PREFIX = 'au1_'

export function uploadTokenHash(token) {
  if (typeof token !== 'string' || !/^wcu1_[A-Za-z0-9_-]{43}$/.test(token)) return ''
  return ROW_PREFIX + createHash('sha256')
    .update('wildcard-afterhours-upload:' + token).digest('hex').slice(0, 60)
}

export function bearerUploadToken(header) {
  if (typeof header !== 'string') return ''
  const match = /^Bearer (wcu1_[A-Za-z0-9_-]{43})$/i.exec(header)
  return match && uploadTokenHash(match[1]) ? match[1] : ''
}

function sql() {
  if (!process.env.DATABASE_URL) {
    const e = new Error('Database is not configured.')
    e.code = 'DATABASE_NOT_CONFIGURED'
    throw e
  }
  return neon(process.env.DATABASE_URL)
}

export async function issueUploadToken(ownerId) {
  await ensureIdentitySchema()
  const token = PREFIX + randomBytes(32).toString('base64url')
  const hash = uploadTokenHash(token)
  const db = sql()
  await db`
    INSERT INTO wildcard_sessions (id, account_id, token_hash, expires_at)
    VALUES (${randomUUID()}::uuid, ${ownerId}::uuid, ${hash}, now() + interval '90 days')
  `
  return { token, expiresInDays: DAYS }
}

export async function ownerFromUploadToken(req) {
  const token = bearerUploadToken(req.headers?.authorization)
  if (!token) return null
  await ensureIdentitySchema()
  const db = sql()
  const hash = uploadTokenHash(token)
  const [row] = await db`
    SELECT account_id::text AS id
    FROM wildcard_sessions
    WHERE token_hash = ${hash} AND expires_at > now()
    LIMIT 1
  `
  return row || null
}

export async function revokeOwnerUploadTokens(ownerId) {
  await ensureIdentitySchema()
  const db = sql()
  const result = await db`
    DELETE FROM wildcard_sessions
    WHERE account_id = ${ownerId}::uuid
      AND substring(token_hash,1,4) = 'au1_'
    RETURNING id
  `
  return result.length
}
