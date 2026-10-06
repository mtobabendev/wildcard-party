import {
  currentAccount,
  databaseNotConfigured,
  sameOrigin,
} from '../../lib/auth-db.js'
import {
  currentConversationCall,
  normalizeUuid,
  startConversationCall,
  updateConversationCall,
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

function callError(res, error) {
  if (error?.code === 'CONVERSATION_NOT_FOUND') {
    return res.status(404).json({ error: 'Conversation not found.' })
  }
  if (error?.code === 'CALL_NOT_FOUND') {
    return res.status(404).json({ error: 'Call not found.' })
  }
  if (error?.code === 'CALL_ALREADY_ACTIVE') {
    return res.status(409).json({ error: 'That conversation already has an active call.' })
  }
  if (error?.code === 'CALL_ACTION_FORBIDDEN') {
    return res.status(403).json({ error: 'That call action is not allowed.' })
  }
  if (error?.code === 'CALL_NOT_ACTIVE') {
    return res.status(409).json({ error: 'That call is no longer active.' })
  }
  if (['INVALID_CALL_IDENTIFIERS', 'INVALID_CALL_ACTION'].includes(error?.code)) {
    return res.status(400).json({ error: 'Call request is invalid.' })
  }
  throw error
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
      if (!conversationId) {
        return res.status(400).json({ error: 'A valid conversationId is required.' })
      }

      try {
        const call = await currentConversationCall({
          accountId: account.id,
          conversationId,
        })
        return res.status(200).json({ call })
      } catch (error) {
        return callError(res, error)
      }
    }

    if (!sameOrigin(req)) {
      return res.status(403).json({ error: 'Origin check failed.' })
    }

    const body = bodyOf(req)
    if (!body) {
      return res.status(400).json({ error: 'Request body must be valid JSON.' })
    }

    const action = typeof body.action === 'string' ? body.action.trim().toLowerCase() : ''

    try {
      if (action === 'start') {
        const conversationId = normalizeUuid(body.conversationId)
        const mode = body.mode === 'audio' || body.mode === 'video' ? body.mode : ''
        if (!conversationId || !mode) {
          return res.status(400).json({ error: 'A valid conversationId and call mode are required.' })
        }

        const call = await startConversationCall({
          accountId: account.id,
          conversationId,
          mode,
        })
        return res.status(201).json({ call })
      }

      if (!['accept', 'decline', 'end'].includes(action)) {
        return res.status(400).json({ error: 'A valid call action is required.' })
      }

      const callId = normalizeUuid(body.callId)
      if (!callId) {
        return res.status(400).json({ error: 'A valid callId is required.' })
      }

      const call = await updateConversationCall({
        accountId: account.id,
        callId,
        action,
      })
      return res.status(200).json({ call })
    } catch (error) {
      return callError(res, error)
    }
  } catch (error) {
    if (databaseNotConfigured(error)) {
      return res.status(503).json({ error: 'COMMS persistence is not connected yet.' })
    }

    console.error('comms calls api error', error)
    return res.status(500).json({ error: 'Call request failed.' })
  }
}
