import {
  createComment,
  databaseNotConfigured,
  deleteComment,
  listComments,
  normalizeOwnerToken,
  updateComment,
} from '../lib/social-db.js'
import { currentAccount, sameOrigin } from '../lib/auth-db.js'
import { bodyOf, createFixedWindowLimiter, textField } from '../lib/http.js'

const allowWrite = createFixedWindowLimiter({
  windowMs: 5 * 60 * 1000,
  maxRequests: 30,
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
    return res.status(503).json({ error: 'Comments are staged but the database is not connected yet.' })
  }
  console.error('comments api error', error)
  return res.status(500).json({ error: 'The comment database refused that request.' })
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')

  try {
    const account = await currentAccount(req)

    if (req.method === 'GET') {
      const postId = typeof req.query?.postId === 'string' ? req.query.postId : ''
      if (!postId) return res.status(400).json({ error: 'postId is required.' })

      const comments = await listComments({
        postId,
        ownerToken: ownerFrom(req),
        accountId: account?.id || '',
      })
      return res.status(200).json({ comments })
    }

    if (!['POST', 'PATCH', 'DELETE'].includes(req.method)) {
      res.setHeader('Allow', 'GET, POST, PATCH, DELETE')
      return res.status(405).json({ error: 'Method not allowed.' })
    }

    if (!sameOrigin(req)) {
      return res.status(403).json({ error: 'Origin check failed.' })
    }

    if (!allowWrite(req)) {
      return res.status(429).json({ error: 'Comments are moving too fast from this connection. Try again shortly.' })
    }

    const body = bodyOf(req)
    const ownerToken = ownerFrom(req, body)

    if (req.method === 'POST') {
      const postId = typeof body.postId === 'string' ? body.postId : ''
      const text = textField(body.body, 1000)
      if (!postId || (!ownerToken && !account) || !text) {
        return res.status(400).json({ error: 'Post ID, comment text, and owner identity are required.' })
      }

      const comment = await createComment({
        postId,
        ownerToken,
        account,
        body: text,
      })
      if (!comment) return res.status(404).json({ error: 'That post no longer exists.' })
      return res.status(201).json({ comment })
    }

    const id = typeof body.id === 'string' ? body.id : ''
    if (!id || (!ownerToken && !account)) {
      return res.status(400).json({ error: 'Comment ID and owner identity are required.' })
    }

    if (req.method === 'PATCH') {
      const text = textField(body.body, 1000)
      if (!text) return res.status(400).json({ error: 'Comment text is required.' })

      const comment = await updateComment({
        id,
        ownerToken,
        accountId: account?.id || '',
        body: text,
      })
      if (!comment) return res.status(403).json({ error: 'That comment is not owned by this account or browser.' })
      return res.status(200).json({ comment })
    }

    const deleted = await deleteComment({
      id,
      ownerToken,
      accountId: account?.id || '',
    })
    if (!deleted) return res.status(403).json({ error: 'That comment is not owned by this account or browser.' })
    return res.status(200).json({ deleted: true })
  } catch (error) {
    return fail(res, error)
  }
}
