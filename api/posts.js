import {
  createPost,
  databaseNotConfigured,
  deletePost,
  listPosts,
  normalizeOwnerToken,
  updatePost,
} from '../lib/social-db.js'
import { currentAccount, sameOrigin } from '../lib/auth-db.js'
import { bodyOf, createFixedWindowLimiter, textField } from '../lib/http.js'

const allowWrite = createFixedWindowLimiter({
  windowMs: 5 * 60 * 1000,
  maxRequests: 20,
})

function ownerFrom(req, body = {}) {
  return normalizeOwnerToken(
    body.ownerToken ||
    req.headers['x-wildcard-owner'] ||
    '',
  )
}

function fail(res, error) {
  if (databaseNotConfigured(error)) {
    return res.status(503).json({ error: 'Social persistence is staged but the database is not connected yet.' })
  }
  console.error('posts api error', error)
  return res.status(500).json({ error: 'The feed database refused that request.' })
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')

  try {
    const account = await currentAccount(req)

    if (req.method === 'GET') {
      const posts = await listPosts({
        ownerToken: ownerFrom(req),
        accountId: account?.id || '',
      })
      return res.status(200).json({ posts })
    }

    if (!['POST', 'PATCH', 'DELETE'].includes(req.method)) {
      res.setHeader('Allow', 'GET, POST, PATCH, DELETE')
      return res.status(405).json({ error: 'Method not allowed.' })
    }

    if (!sameOrigin(req)) {
      return res.status(403).json({ error: 'Origin check failed.' })
    }

    if (!allowWrite(req)) {
      return res.status(429).json({ error: 'The feed is moving too fast from this connection. Try again shortly.' })
    }

    const body = bodyOf(req)
    const ownerToken = ownerFrom(req, body)

    if (req.method === 'POST') {
      const text = textField(body.body, 2000)
      if ((!ownerToken && !account) || !text) {
        return res.status(400).json({ error: 'A post needs text and a valid owner identity.' })
      }
      const post = await createPost({ ownerToken, account, body: text })
      return res.status(201).json({ post })
    }

    const id = typeof body.id === 'string' ? body.id : ''
    if (!id || (!ownerToken && !account)) {
      return res.status(400).json({ error: 'Post ID and owner identity are required.' })
    }

    if (req.method === 'PATCH') {
      const text = textField(body.body, 2000)
      if (!text) return res.status(400).json({ error: 'Post text is required.' })
      const post = await updatePost({
        id,
        ownerToken,
        accountId: account?.id || '',
        body: text,
      })
      if (!post) return res.status(403).json({ error: 'That post is not owned by this account or browser.' })
      return res.status(200).json({ post })
    }

    const deleted = await deletePost({
      id,
      ownerToken,
      accountId: account?.id || '',
    })
    if (!deleted) return res.status(403).json({ error: 'That post is not owned by this account or browser.' })
    return res.status(200).json({ deleted: true })
  } catch (error) {
    return fail(res, error)
  }
}
