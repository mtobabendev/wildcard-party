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

export function authorFromOwner(token) {
  const hash = ownerHash(token)
  if (!hash) return null
  return {
    ownerHash: hash,
    authorRef: 'anon:' + hash.slice(0, 16),
    authorName: 'Guest Operative',
    authorHandle: '@guest.' + hash.slice(0, 6),
  }
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
        CREATE INDEX IF NOT EXISTS wildcard_comments_post_created_idx
        ON wildcard_comments (post_id, created_at ASC)
      `
    })().catch((error) => {
      schemaPromise = null
      throw error
    })
  }

  return schemaPromise
}

export async function listPosts(ownerToken = '') {
  await ensureSocialSchema()
  const sql = database()
  const viewerHash = ownerHash(ownerToken)

  const rows = await sql`
    SELECT
      p.id,
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
    authorRef: row.author_ref,
    authorName: row.author_name,
    authorHandle: row.author_handle,
    body: row.body,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    commentCount: Number(row.comment_count || 0),
    owned: Boolean(viewerHash && row.owner_token_hash === viewerHash),
  }))
}

export async function createPost({ ownerToken, body }) {
  await ensureSocialSchema()
  const sql = database()
  const author = authorFromOwner(ownerToken)

  if (!author) {
    const error = new Error('A valid local owner token is required.')
    error.code = 'INVALID_OWNER'
    throw error
  }

  const id = randomUUID()
  const [row] = await sql`
    INSERT INTO wildcard_posts (
      id, owner_token_hash, author_ref, author_name, author_handle, body
    )
    VALUES (
      ${id},
      ${author.ownerHash},
      ${author.authorRef},
      ${author.authorName},
      ${author.authorHandle},
      ${body}
    )
    RETURNING id, author_ref, author_name, author_handle, body, created_at, updated_at
  `

  return {
    id: row.id,
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

export async function updatePost({ id, ownerToken, body }) {
  await ensureSocialSchema()
  const sql = database()
  const hash = ownerHash(ownerToken)
  if (!hash) return null

  const [row] = await sql`
    UPDATE wildcard_posts
    SET body = ${body}, updated_at = now()
    WHERE id = ${id}::uuid AND owner_token_hash = ${hash}
    RETURNING id, author_ref, author_name, author_handle, body, created_at, updated_at
  `

  if (!row) return null

  return {
    id: row.id,
    authorRef: row.author_ref,
    authorName: row.author_name,
    authorHandle: row.author_handle,
    body: row.body,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    owned: true,
  }
}

export async function deletePost({ id, ownerToken }) {
  await ensureSocialSchema()
  const sql = database()
  const hash = ownerHash(ownerToken)
  if (!hash) return false

  const rows = await sql`
    DELETE FROM wildcard_posts
    WHERE id = ${id}::uuid AND owner_token_hash = ${hash}
    RETURNING id
  `

  return rows.length > 0
}

export async function listComments({ postId, ownerToken = '' }) {
  await ensureSocialSchema()
  const sql = database()
  const viewerHash = ownerHash(ownerToken)

  const rows = await sql`
    SELECT
      id,
      post_id,
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
    authorRef: row.author_ref,
    authorName: row.author_name,
    authorHandle: row.author_handle,
    body: row.body,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    owned: Boolean(viewerHash && row.owner_token_hash === viewerHash),
  }))
}

export async function createComment({ postId, ownerToken, body }) {
  await ensureSocialSchema()
  const sql = database()
  const author = authorFromOwner(ownerToken)

  if (!author) {
    const error = new Error('A valid local owner token is required.')
    error.code = 'INVALID_OWNER'
    throw error
  }

  const id = randomUUID()
  const rows = await sql`
    INSERT INTO wildcard_comments (
      id, post_id, owner_token_hash, author_ref, author_name, author_handle, body
    )
    SELECT
      ${id},
      p.id,
      ${author.ownerHash},
      ${author.authorRef},
      ${author.authorName},
      ${author.authorHandle},
      ${body}
    FROM wildcard_posts p
    WHERE p.id = ${postId}::uuid
    RETURNING id, post_id, author_ref, author_name, author_handle, body, created_at, updated_at
  `

  const row = rows[0]
  if (!row) return null

  return {
    id: row.id,
    postId: row.post_id,
    authorRef: row.author_ref,
    authorName: row.author_name,
    authorHandle: row.author_handle,
    body: row.body,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    owned: true,
  }
}

export async function updateComment({ id, ownerToken, body }) {
  await ensureSocialSchema()
  const sql = database()
  const hash = ownerHash(ownerToken)
  if (!hash) return null

  const [row] = await sql`
    UPDATE wildcard_comments
    SET body = ${body}, updated_at = now()
    WHERE id = ${id}::uuid AND owner_token_hash = ${hash}
    RETURNING id, post_id, author_ref, author_name, author_handle, body, created_at, updated_at
  `

  if (!row) return null

  return {
    id: row.id,
    postId: row.post_id,
    authorRef: row.author_ref,
    authorName: row.author_name,
    authorHandle: row.author_handle,
    body: row.body,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    owned: true,
  }
}

export async function deleteComment({ id, ownerToken }) {
  await ensureSocialSchema()
  const sql = database()
  const hash = ownerHash(ownerToken)
  if (!hash) return false

  const rows = await sql`
    DELETE FROM wildcard_comments
    WHERE id = ${id}::uuid AND owner_token_hash = ${hash}
    RETURNING id
  `

  return rows.length > 0
}

export function databaseNotConfigured(error) {
  return error?.code === 'DATABASE_NOT_CONFIGURED'
}
