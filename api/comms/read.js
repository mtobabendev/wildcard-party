import {
  currentAccount,
  databaseNotConfigured,
  sameOrigin,
} from '../../lib/auth-db.js'
import {
  markConversationRead,
  normalizeUuid,
  totalUnreadCount,
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

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')

  try {
    const account = await currentAccount(req)
    if (!account) {
      return res.status(401).json({ error: 'Sign in is required for COMMS.' })
    }

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST')
      return res.status(405).json({ error: 'Method not allowed.' })
    }

    if (!sameOrigin(req)) {
      return res.status(403).json({ error: 'Origin check failed.' })
    }

    const body = bodyOf(req)
    if (!body) {
      return res.status(400).json({ error: 'Request body must be valid JSON.' })
    }

    const conversationId = normalizeUuid(body.conversationId)
    const messageId = normalizeUuid(body.messageId)

    if (!conversationId || !messageId) {
      return res.status(400).json({
        error: 'Valid conversationId and messageId values are required.',
      })
    }

    const readState = await markConversationRead({
      accountId: account.id,
      conversationId,
      messageId,
    })

    if (!readState) {
      return res.status(404).json({ error: 'Conversation not found.' })
    }

    const unreadCount = await totalUnreadCount(account.id)
    return res.status(200).json({ readState, unreadCount })
  } catch (error) {
    if (databaseNotConfigured(error)) {
      return res.status(503).json({ error: 'COMMS persistence is not connected yet.' })
    }

    console.error('comms read api error', error)
    return res.status(500).json({ error: 'Read state could not be updated.' })
  }
}
