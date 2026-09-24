import {
  createHash,
  randomBytes,
  randomUUID,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto'
import { promisify } from 'node:util'
import { neon } from '@neondatabase/serverless'
import { ownerHash } from './social-db.js'

const scrypt = promisify(scryptCallback)
const SESSION_COOKIE = '__Host-wildcard_session'
const SESSION_SECONDS = 60 * 60 * 24 * 30
const SCRYPT_N = 32768
const SCRYPT_R = 8
const SCRYPT_P = 1
const KEY_LENGTH = 64
let schemaPromise

function database() {
  if (!process.env.DATABASE_URL) {
    const error = new Error('DATABASE_URL is not configured.')
    error.code = 'DATABASE_NOT_CONFIGURED'
    throw error
  }
  return neon(process.env.DATABASE_URL)
}

export function normalizeHandle(value) {
  if (typeof value !== 'string') return ''
  const handle = value.trim().toLowerCase().replace(/^@+/, '')
  if (!/^[a-z0-9_]{3,24}$/.test(handle)) return ''
  return handle
}

export function normalizeDisplayName(value) {
  if (typeof value !== 'string') return ''
  const name = value.trim().replace(/\s+/g, ' ')
  if (name.length < 2 || name.length > 60) return ''
  return name
}

export function normalizeBio(value) {
  if (value == null || value === '') return ''
  if (typeof value !== 'string') return null
  const bio = value.trim()
  if (bio.length > 280) return null
  return bio
}

export function validPassword(value) {
  return typeof value === 'string' && value.length >= 10 && value.length <= 128
}

async function hashPassword(password) {
  const salt = randomBytes(16)
  const derived = await scrypt(password, salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: 64 * 1024 * 1024,
  })

  return [
    'scrypt',
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString('base64url'),
    Buffer.from(derived).toString('base64url'),
  ].join('$')
}

async function verifyPassword(password, encoded) {
  if (typeof encoded !== 'string') return false
  const parts = encoded.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false

  const [, nRaw, rRaw, pRaw, saltRaw, keyRaw] = parts
  const N = Number(nRaw)
  const r = Number(rRaw)
  const p = Number(pRaw)
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false

  const salt = Buffer.from(saltRaw, 'base64url')
  const expected = Buffer.from(keyRaw, 'base64url')
  if (expected.length !== KEY_LENGTH) return false

  const actual = await scrypt(password, salt, expected.length, {
    N,
    r,
    p,
    maxmem: 64 * 1024 * 1024,
  })

  return timingSafeEqual(expected, Buffer.from(actual))
}

export async function ensureIdentitySchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      const sql = database()

      await sql`
        CREATE TABLE IF NOT EXISTS wildcard_accounts (
          id uuid PRIMARY KEY,
          handle varchar(24) NOT NULL UNIQUE,
          display_name varchar(60) NOT NULL,
          bio varchar(280) NOT NULL DEFAULT '',
          password_hash text NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        )
      `

      await sql`
        CREATE TABLE IF NOT EXISTS wildcard_sessions (
          id uuid PRIMARY KEY,
          account_id uuid NOT NULL REFERENCES wildcard_accounts(id) ON DELETE CASCADE,
          token_hash char(64) NOT NULL UNIQUE,
          created_at timestamptz NOT NULL DEFAULT now(),
          expires_at timestamptz NOT NULL,
          last_seen_at timestamptz NOT NULL DEFAULT now()
        )
      `

      await sql`
        CREATE INDEX IF NOT EXISTS wildcard_sessions_account_idx
        ON wildcard_sessions (account_id)
      `

      await sql`
        CREATE INDEX IF NOT EXISTS wildcard_sessions_expiry_idx
        ON wildcard_sessions (expires_at)
      `
    })().catch((error) => {
      schemaPromise = null
      throw error
    })
  }

  return schemaPromise
}

function publicAccount(row) {
  if (!row) return null
  return {
    id: row.id,
    handle: row.handle,
    displayName: row.display_name,
    bio: row.bio || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function registerAccount({ handle, displayName, password }) {
  await ensureIdentitySchema()
  const sql = database()
  const id = randomUUID()
  const passwordHash = await hashPassword(password)

  try {
    const [row] = await sql`
      INSERT INTO wildcard_accounts (
        id, handle, display_name, password_hash
      )
      VALUES (
        ${id}, ${handle}, ${displayName}, ${passwordHash}
      )
      RETURNING id, handle, display_name, bio, created_at, updated_at
    `

    return publicAccount(row)
  } catch (error) {
    if (error?.code === '23505') {
      error.code = 'HANDLE_TAKEN'
    }
    throw error
  }
}

export async function authenticateAccount({ handle, password }) {
  await ensureIdentitySchema()
  const sql = database()

  const [row] = await sql`
    SELECT id, handle, display_name, bio, password_hash, created_at, updated_at
    FROM wildcard_accounts
    WHERE handle = ${handle}
    LIMIT 1
  `

  if (!row || !(await verifyPassword(password, row.password_hash))) {
    return null
  }

  return publicAccount(row)
}

function cookieValue(req, name) {
  if (req.cookies && typeof req.cookies[name] === 'string') {
    return req.cookies[name]
  }

  const raw = req.headers.cookie
  if (typeof raw !== 'string') return ''

  for (const part of raw.split(';')) {
    const index = part.indexOf('=')
    if (index < 0) continue
    const key = part.slice(0, index).trim()
    if (key === name) {
      return decodeURIComponent(part.slice(index + 1).trim())
    }
  }

  return ''
}

function sessionHash(token) {
  return createHash('sha256').update(token).digest('hex')
}

export async function createSession(res, accountId) {
  await ensureIdentitySchema()
  const sql = database()
  const token = randomBytes(32).toString('base64url')
  const hash = sessionHash(token)
  const id = randomUUID()

  await sql`
    INSERT INTO wildcard_sessions (
      id, account_id, token_hash, expires_at
    )
    VALUES (
      ${id},
      ${accountId}::uuid,
      ${hash},
      now() + interval '30 days'
    )
  `

  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${SESSION_SECONDS}; HttpOnly; Secure; SameSite=Lax`,
  )
}

export async function deleteCurrentSession(req, res) {
  await ensureIdentitySchema()
  const token = cookieValue(req, SESSION_COOKIE)

  if (token) {
    const sql = database()
    const hash = sessionHash(token)
    await sql`
      DELETE FROM wildcard_sessions
      WHERE token_hash = ${hash}
    `
  }

  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`,
  )
}

export async function currentAccount(req) {
  await ensureIdentitySchema()
  const token = cookieValue(req, SESSION_COOKIE)
  if (!token) return null

  const sql = database()
  const hash = sessionHash(token)

  const [row] = await sql`
    SELECT
      a.id,
      a.handle,
      a.display_name,
      a.bio,
      a.created_at,
      a.updated_at
    FROM wildcard_sessions s
    JOIN wildcard_accounts a ON a.id = s.account_id
    WHERE s.token_hash = ${hash}
      AND s.expires_at > now()
    LIMIT 1
  `

  if (!row) return null

  sql`
    UPDATE wildcard_sessions
    SET last_seen_at = now()
    WHERE token_hash = ${hash}
  `.catch(() => {})

  return publicAccount(row)
}

export async function updateAccountProfile(accountId, { handle, displayName, bio }) {
  await ensureIdentitySchema()
  const sql = database()

  try {
    const [row] = await sql`
      UPDATE wildcard_accounts
      SET
        handle = ${handle},
        display_name = ${displayName},
        bio = ${bio},
        updated_at = now()
      WHERE id = ${accountId}::uuid
      RETURNING id, handle, display_name, bio, created_at, updated_at
    `

    return publicAccount(row)
  } catch (error) {
    if (error?.code === '23505') {
      error.code = 'HANDLE_TAKEN'
    }
    throw error
  }
}

export async function claimAnonymousContent(account, ownerToken) {
  const hash = ownerHash(ownerToken)
  if (!account?.id || !hash) return { posts: 0, comments: 0 }

  const sql = database()

  const posts = await sql`
    UPDATE wildcard_posts
    SET
      account_id = ${account.id}::uuid,
      author_ref = ${'account:' + account.id},
      author_name = ${account.displayName},
      author_handle = ${'@' + account.handle},
      updated_at = now()
    WHERE owner_token_hash = ${hash}
      AND account_id IS NULL
    RETURNING id
  `

  const comments = await sql`
    UPDATE wildcard_comments
    SET
      account_id = ${account.id}::uuid,
      author_ref = ${'account:' + account.id},
      author_name = ${account.displayName},
      author_handle = ${'@' + account.handle},
      updated_at = now()
    WHERE owner_token_hash = ${hash}
      AND account_id IS NULL
    RETURNING id
  `

  return {
    posts: posts.length,
    comments: comments.length,
  }
}

export function sameOrigin(req) {
  const origin = req.headers.origin
  if (!origin) return true

  const host = req.headers['x-forwarded-host'] || req.headers.host
  if (!host) return false

  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

export function databaseNotConfigured(error) {
  return error?.code === 'DATABASE_NOT_CONFIGURED'
}
