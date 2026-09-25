import {
  currentAccount,
  databaseNotConfigured,
  sameOrigin,
} from '../../lib/auth-db.js'
import {
  createMessage,
  listMessages,
  normalizeUuid,
} from '../../lib/comms-db.js'

function bodyOf(req) {
  if (req.body && typeof req.body === 'object') return req.body
  if (typeof req.body !== 'string' || !req.body.trim()) return {}

  try {
    return JSON.parse(req.body)
  } catch {
    return null
  }
}

function queryValue(value) {
  return typeof value === 'string' ? value : ''
}

function normalizedBody(value) {
  if (typeof value !== 'string') return ''
  const body = value.trim()
  const length = Array.from(body).length
  if (length < 1 || length > 4000) return ''
  return body
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')

  try {
    const account = await currentAccount(req)
    if (!account) {
      return res.status(401).json({ error: 'Sign in is required for COMMS.' })
    }

    if (!['GET', 'POST'].includes(req.method)) {
      res.setHeader('Allow', 'GET, POST')
      return res.status(405).json({ error: 'Method not allowed.' })
    }

    if (req.method === 'GET') {
      const conversationId = normalizeUuid(queryValue(req.query?.conversationId))
      const afterRaw = queryValue(req.query?.after)
      const beforeRaw = queryValue(req.query?.before)
      const after = afterRaw ? normalizeUuid(afterRaw) : ''
      const before = beforeRaw ? normalizeUuid(beforeRaw) : ''

      if (!conversationId) {
        return res.status(400).json({ error: 'A valid conversationId is required.' })
      }
      if (afterRaw && !after) {
        return res.status(400).json({ error: 'after must be a valid message UUID.' })
      }
      if (beforeRaw && !before) {
        return res.status(400).json({ error: 'before must be a valid message UUID.' })
      }
      if (after && before) {
        return res.status(400).json({ error: 'Use either after or before, not both.' })
      }

      const result = await listMessages({
        accountId: account.id,
        conversationId,
        after,
        before,
      })

      if (result === null) {
        return res.status(404).json({ error: 'Conversation not found.' })
      }

      return res.status(200).json(result)
    }

    if (!sameOrigin(req)) {
      return res.status(403).json({ error: 'Origin check failed.' })
    }

    const body = bodyOf(req)
    if (!body) {
      return res.status(400).json({ error: 'Request body must be valid JSON.' })
    }

    const conversationId = normalizeUuid(body.conversationId)
    const clientMessageId = normalizeUuid(body.clientMessageId)
    const text = normalizedBody(body.body)

    if (!conversationId || !clientMessageId || !text) {
      return res.status(400).json({
        error: 'conversationId, clientMessageId, and 1–4000 characters of text are required.',
      })
    }

    try {
      const result = await createMessage({
        accountId: account.id,
        conversationId,
        clientMessageId,
        body: text,
      })

      return res
        .status(result.replayed ? 200 : 201)
        .json({ message: result.message })
    } catch (error) {
      if (error?.code === 'IDEMPOTENCY_CONFLICT') {
        return res.status(409).json({ error: 'That clientMessageId conflicts with an earlier send.' })
      }
      if (error?.code === 'CONVERSATION_NOT_FOUND') {
        return res.status(404).json({ error: 'Conversation not found.' })
      }
      if (error?.code === 'INVALID_MESSAGE_IDENTIFIERS') {
        return res.status(400).json({ error: 'Message identifiers are invalid.' })
      }
      throw error
    }
  } catch (error) {
    if (databaseNotConfigured(error)) {
      return res.status(503).json({ error: 'COMMS persistence is not connected yet.' })
    }

    console.error('comms messages api error', error)
    return res.status(500).json({ error: 'Message request failed.' })
  }
}
