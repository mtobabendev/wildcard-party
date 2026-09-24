import {
  currentAccount,
  databaseNotConfigured,
  sameOrigin,
} from '../../lib/auth-db.js'
import {
  listConversations,
  normalizeUuid,
  openConversation,
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

  if (!['GET', 'POST'].includes(req.method)) {
    res.setHeader('Allow', 'GET, POST')
    return res.status(405).json({ error: 'Method not allowed.' })
  }

  try {
    const account = await currentAccount(req)
    if (!account) {
      return res.status(401).json({ error: 'Sign in is required for COMMS.' })
    }

    if (req.method === 'GET') {
      const conversations = await listConversations(account.id)
      return res.status(200).json({ conversations })
    }

    if (!sameOrigin(req)) {
      return res.status(403).json({ error: 'Origin check failed.' })
    }

    const body = bodyOf(req)
    if (!body) {
      return res.status(400).json({ error: 'Request body must be valid JSON.' })
    }

    const otherAccountId = normalizeUuid(body.accountId)
    if (!otherAccountId) {
      return res.status(400).json({ error: 'A valid accountId is required.' })
    }

    if (otherAccountId === account.id.toLowerCase()) {
      return res.status(400).json({ error: 'You cannot open a direct message with yourself.' })
    }

    try {
      const conversation = await openConversation(account.id, otherAccountId)
      return res.status(200).json({ conversation })
    } catch (error) {
      if (error?.code === 'ACCOUNT_NOT_FOUND') {
        return res.status(404).json({ error: 'That account does not exist.' })
      }
      if (error?.code === 'INVALID_CONVERSATION_PAIR') {
        return res.status(400).json({ error: 'Conversation participants are invalid.' })
      }
      throw error
    }
  } catch (error) {
    if (databaseNotConfigured(error)) {
      return res.status(503).json({ error: 'COMMS persistence is not connected yet.' })
    }

    console.error('comms conversations api error', error)
    return res.status(500).json({ error: 'Conversation request failed.' })
  }
}
