import { createHash, randomUUID } from 'node:crypto'
import { neon } from '@neondatabase/serverless'

let schemaPromise

function database() {
  if (!process.env.DATABASE_URL) {
    const error = new Error('DATABASE_URL is not configured.')
    error.code = 'DATABASE_NOT_CONFIGURED'
    throw error
  }
  return neon(process.env.DATABASE_URL)
}

export function normalizeOwnerToken(value) {
  if (typeof value !== 'string') return ''
  const token = value.trim()
  if (token.length < 32 || token.length > 200) return ''
  return token
}

export function ownerHash(token) {
  const normalized = normalizeOwnerToken(token)
  if (!normalized) return ''
  return createHash('sha256').update(normalized).digest('hex')
}

function accountFallbackHash(accountId) {
  if (!accountId) return ''
  return createHash('sha256').update('account:' + accountId).digest('hex')
}

export function authorFromOwner(token) {
  const hash = ownerHash(token)
  if (!hash) return null
  return {
    ownerHash: hash,
    accountId: null,
    authorRef: 'anon:' + hash.slice(0, 16),
    authorName: 'Guest Operative',
    authorHandle: '@guest.' + hash.slice(0, 6),
  }
}

function authorFromAccount(account, token) {
  if (!account?.id) return null
  return {
    ownerHash: ownerHash(token) || accountFallbackHash(account.id),
    accountId: account.id,
    authorRef: 'account:' + account.id,
    authorName: account.displayName,
    authorHandle: '@' + account.handle,
  }
}

function authorFor({ ownerToken, account }) {
  return authorFromAccount(account, ownerToken) || authorFromOwner(ownerToken)
}

function ownedBy(row, { ownerToken = '', accountId = '' } = {}) {
  const hash = ownerHash(ownerToken)
  if (accountId && row.account_id === accountId) return true
  return Boolean(hash && row.owner_token_hash === hash)
}

export async function ensureSocialSchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      const sql = database()

      await sql`
        CREATE TABLE IF NOT EXISTS wildcard_posts (
          id uuid PRIMARY KEY,
          account_id uuid NULL,
          owner_token_hash char(64) NOT NULL,
          author_ref varchar(96) NOT NULL,
          author_name varchar(80) NOT NULL,
          author_handle varchar(80) NOT NULL,
          body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        )
      `

      await sql`
        CREATE TABLE IF NOT EXISTS wildcard_comments (
          id uuid PRIMARY KEY,
          post_id uuid NOT NULL REFERENCES wildcard_posts(id) ON DELETE CASCADE,
          account_id uuid NULL,
          owner_token_hash char(64) NOT NULL,
          author_ref varchar(96) NOT NULL,
          author_name varchar(80) NOT NULL,
          author_handle varchar(80) NOT NULL,
          body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 1000),
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        )
      `

      await sql`
        CREATE INDEX IF NOT EXISTS wildcard_posts_created_at_idx
        ON wildcard_posts (created_at DESC)
      `

      await sql`
        CREATE INDEX IF NOT EXISTS wildcard_posts_account_idx
        ON wildcard_posts (account_id)
      `

      await sql`
        CREATE INDEX IF NOT EXISTS wildcard_comments_post_created_idx
        ON wildcard_comments (post_id, created_at ASC)
      `

      await sql`
        CREATE INDEX IF NOT EXISTS wildcard_comments_account_idx
        ON wildcard_comments (account_id)
      `
    })().catch((error) => {
      schemaPromise = null
      throw error
    })
  }

  return schemaPromise
}

export async function listPosts({ ownerToken = '', accountId = '' } = {}) {
  await ensureSocialSchema()
  const sql = database()

  const rows = await sql`
    SELECT
      p.id,
      p.account_id,
      p.author_ref,
      p.author_name,
      p.author_handle,
      p.body,
      p.created_at,
      p.updated_at,
      p.owner_token_hash,
      COUNT(c.id)::int AS comment_count
    FROM wildcard_posts p
    LEFT JOIN wildcard_comments c ON c.post_id = p.id
    GROUP BY p.id
    ORDER BY p.created_at DESC
    LIMIT 50
  `

  return rows.map((row) => ({
    id: row.id,
    accountId: row.account_id,
    authorRef: row.author_ref,
    authorName: row.author_name,
    authorHandle: row.author_handle,
    body: row.body,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    commentCount: Number(row.comment_count || 0),
    owned: ownedBy(row, { ownerToken, accountId }),
  }))
}

export async function createPost({ ownerToken, account = null, body }) {
  await ensureSocialSchema()
  const sql = database()
  const author = authorFor({ ownerToken, account })

  if (!author) {
    const error = new Error('A valid owner identity is required.')
    error.code = 'INVALID_OWNER'
    throw error
  }

  const id = randomUUID()
  const [row] = await sql`
    INSERT INTO wildcard_posts (
      id,
      account_id,
      owner_token_hash,
      author_ref,
      author_name,
      author_handle,
      body
    )
    VALUES (
      ${id},
      ${author.accountId}::uuid,
      ${author.ownerHash},
      ${author.authorRef},
      ${author.authorName},
      ${author.authorHandle},
      ${body}
    )
    RETURNING
      id,
      account_id,
      author_ref,
      author_name,
      author_handle,
      body,
      created_at,
      updated_at
  `

  return {
    id: row.id,
    accountId: row.account_id,
    authorRef: row.author_ref,
    authorName: row.author_name,
    authorHandle: row.author_handle,
    body: row.body,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    commentCount: 0,
    owned: true,
  }
}

export async function updatePost({ id, ownerToken, accountId = '', body }) {
  await ensureSocialSchema()
  const sql = database()
  const hash = ownerHash(ownerToken)
  const normalizedAccountId = accountId || null

  if (!hash && !normalizedAccountId) return null

  const [row] = await sql`
    UPDATE wildcard_posts
    SET body = ${body}, updated_at = now()
    WHERE id = ${id}::uuid
      AND (
        account_id = ${normalizedAccountId}::uuid
        OR owner_token_hash = ${hash || null}
      )
    RETURNING
      id,
      account_id,
      author_ref,
      author_name,
      author_handle,
      body,
      created_at,
      updated_at
  `

  if (!row) return null

  return {
    id: row.id,
    accountId: row.account_id,
    authorRef: row.author_ref,
    authorName: row.author_name,
    authorHandle: row.author_handle,
    body: row.body,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    owned: true,
  }
}

export async function deletePost({ id, ownerToken, accountId = '' }) {
  await ensureSocialSchema()
  const sql = database()
  const hash = ownerHash(ownerToken)
  const normalizedAccountId = accountId || null

  if (!hash && !normalizedAccountId) return false

  const rows = await sql`
    DELETE FROM wildcard_posts
    WHERE id = ${id}::uuid
      AND (
        account_id = ${normalizedAccountId}::uuid
        OR owner_token_hash = ${hash || null}
      )
    RETURNING id
  `

  return rows.length > 0
}

export async function listComments({ postId, ownerToken = '', accountId = '' }) {
  await ensureSocialSchema()
  const sql = database()

  const rows = await sql`
    SELECT
      id,
      post_id,
      account_id,
      author_ref,
      author_name,
      author_handle,
      body,
      created_at,
      updated_at,
      owner_token_hash
    FROM wildcard_comments
    WHERE post_id = ${postId}::uuid
    ORDER BY created_at ASC
    LIMIT 100
  `

  return rows.map((row) => ({
    id: row.id,
    postId: row.post_id,
    accountId: row.account_id,
    authorRef: row.author_ref,
    authorName: row.author_name,
    authorHandle: row.author_handle,
    body: row.body,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    owned: ownedBy(row, { ownerToken, accountId }),
  }))
}

export async function createComment({ postId, ownerToken, account = null, body }) {
  await ensureSocialSchema()
  const sql = database()
  const author = authorFor({ ownerToken, account })

  if (!author) {
    const error = new Error('A valid owner identity is required.')
    error.code = 'INVALID_OWNER'
    throw error
  }

  const id = randomUUID()
  const rows = await sql`
    INSERT INTO wildcard_comments (
      id,
      post_id,
      account_id,
      owner_token_hash,
      author_ref,
      author_name,
      author_handle,
      body
    )
    SELECT
      ${id},
      p.id,
      ${author.accountId}::uuid,
      ${author.ownerHash},
      ${author.authorRef},
      ${author.authorName},
      ${author.authorHandle},
      ${body}
    FROM wildcard_posts p
    WHERE p.id = ${postId}::uuid
    RETURNING
      id,
      post_id,
      account_id,
      author_ref,
      author_name,
      author_handle,
      body,
      created_at,
      updated_at
  `

  const row = rows[0]
  if (!row) return null

  return {
    id: row.id,
    postId: row.post_id,
    accountId: row.account_id,
    authorRef: row.author_ref,
    authorName: row.author_name,
    authorHandle: row.author_handle,
    body: row.body,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    owned: true,
  }
}

export async function updateComment({ id, ownerToken, accountId = '', body }) {
  await ensureSocialSchema()
  const sql = database()
  const hash = ownerHash(ownerToken)
  const normalizedAccountId = accountId || null

  if (!hash && !normalizedAccountId) return null

  const [row] = await sql`
    UPDATE wildcard_comments
    SET body = ${body}, updated_at = now()
    WHERE id = ${id}::uuid
      AND (
        account_id = ${normalizedAccountId}::uuid
        OR owner_token_hash = ${hash || null}
      )
    RETURNING
      id,
      post_id,
      account_id,
      author_ref,
      author_name,
      author_handle,
      body,
      created_at,
      updated_at
  `

  if (!row) return null

  return {
    id: row.id,
    postId: row.post_id,
    accountId: row.account_id,
    authorRef: row.author_ref,
    authorName: row.author_name,
    authorHandle: row.author_handle,
    body: row.body,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    owned: true,
  }
}

export async function deleteComment({ id, ownerToken, accountId = '' }) {
  await ensureSocialSchema()
  const sql = database()
  const hash = ownerHash(ownerToken)
  const normalizedAccountId = accountId || null

  if (!hash && !normalizedAccountId) return false

  const rows = await sql`
    DELETE FROM wildcard_comments
    WHERE id = ${id}::uuid
      AND (
        account_id = ${normalizedAccountId}::uuid
        OR owner_token_hash = ${hash || null}
      )
    RETURNING id
  `

  return rows.length > 0
}

export function databaseNotConfigured(error) {
  return error?.code === 'DATABASE_NOT_CONFIGURED'
}
