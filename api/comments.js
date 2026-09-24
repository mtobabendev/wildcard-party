import {
  createComment,
  databaseNotConfigured,
  deleteComment,
  listComments,
  normalizeOwnerToken,
  updateComment,
} from '../lib/social-db.js'

const WINDOW_MS = 5 * 60 * 1000
const MAX_WRITES = 30
const writeBuckets = new Map()

function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for']
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim()
  }
  return req.socket?.remoteAddress || 'unknown'
}

function allowWrite(ip) {
  const now = Date.now()
  const floor = now - WINDOW_MS
  const recent = (writeBuckets.get(ip) || []).filter((stamp) => stamp > floor)

  if (recent.length >= MAX_WRITES) {
    writeBuckets.set(ip, recent)
    return false
  }

  recent.push(now)
  writeBuckets.set(ip, recent)
  return true
}

function bodyOf(req) {
  if (req.body && typeof req.body === 'object') return req.body
  if (typeof req.body === 'string' && req.body.trim()) return JSON.parse(req.body)
  return {}
}

function textField(value, max) {
  if (typeof value !== 'string') return ''
  const text = value.trim()
  if (!text || text.length > max) return ''
  return text
}

function ownerFrom(req, body = {}) {
  return normalizeOwnerToken(
    body.ownerToken ||
    req.headers['x-wildcard-owner'] ||
    '',
  )
}

function fail(res, error) {
  if (databaseNotConfigured(error)) {
    return res.status(503).json({
      error: 'Comments are staged but the database is not connected yet.',
    })
  }

  console.error('comments api error', error)
  return res.status(500).json({
    error: 'The comment database refused that request.',
  })
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')

  try {
    if (req.method === 'GET') {
      const postId = typeof req.query?.postId === 'string' ? req.query.postId : ''

      if (!postId) {
        return res.status(400).json({ error: 'postId is required.' })
      }

      const comments = await listComments({
        postId,
        ownerToken: ownerFrom(req),
      })

      return res.status(200).json({ comments })
    }

    if (!['POST', 'PATCH', 'DELETE'].includes(req.method)) {
      res.setHeader('Allow', 'GET, POST, PATCH, DELETE')
      return res.status(405).json({ error: 'Method not allowed.' })
    }

    if (!allowWrite(clientIp(req))) {
      return res.status(429).json({
        error: 'Comments are moving too fast from this connection. Try again shortly.',
      })
    }

    const body = bodyOf(req)
    const ownerToken = ownerFrom(req, body)

    if (req.method === 'POST') {
      const postId = typeof body.postId === 'string' ? body.postId : ''
      const text = textField(body.body, 1000)

      if (!postId || !ownerToken || !text) {
        return res.status(400).json({
          error: 'Post ID, comment text, and owner token are required.',
        })
      }

      const comment = await createComment({
        postId,
        ownerToken,
        body: text,
      })

      if (!comment) {
        return res.status(404).json({
          error: 'That post no longer exists.',
        })
      }

      return res.status(201).json({ comment })
    }

    const id = typeof body.id === 'string' ? body.id : ''

    if (!id || !ownerToken) {
      return res.status(400).json({
        error: 'Comment ID and owner token are required.',
      })
    }

    if (req.method === 'PATCH') {
      const text = textField(body.body, 1000)

      if (!text) {
        return res.status(400).json({
          error: 'Comment text is required.',
        })
      }

      const comment = await updateComment({
        id,
        ownerToken,
        body: text,
      })

      if (!comment) {
        return res.status(403).json({
          error: 'That comment is not owned by this local session.',
        })
      }

      return res.status(200).json({ comment })
    }

    const deleted = await deleteComment({ id, ownerToken })

    if (!deleted) {
      return res.status(403).json({
        error: 'That comment is not owned by this local session.',
      })
    }

    return res.status(200).json({ deleted: true })
  } catch (error) {
    return fail(res, error)
  }
}
