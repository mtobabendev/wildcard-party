import {
  currentAccount,
  databaseNotConfigured,
  sameOrigin,
} from '../../lib/auth-db.js'
import { normalizeUuid } from '../../lib/comms-db.js'
import {
  createCall,
  getActiveCallForAccount,
  getCallForParticipant,
  normalizeCallAction,
  normalizeCallKind,
  transitionCall,
} from '../../lib/comms-calls.js'

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

function conflict(res, code, error) {
  return res.status(409).json({ code, error })
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')

  try {
    const account = await currentAccount(req)
    if (!account) {
      return res.status(401).json({ error: 'Sign in is required for COMMS calls.' })
    }

    if (!['GET', 'POST', 'PATCH'].includes(req.method)) {
      res.setHeader('Allow', 'GET, POST, PATCH')
      return res.status(405).json({ error: 'Method not allowed.' })
    }

    if (req.method === 'GET') {
      const idRaw = queryValue(req.query?.id)

      if (idRaw) {
        const callId = normalizeUuid(idRaw)
        if (!callId) {
          return res.status(404).json({ error: 'Call not found.' })
        }

        const call = await getCallForParticipant(account.id, callId)
        if (!call) {
          return res.status(404).json({ error: 'Call not found.' })
        }

        return res.status(200).json({ call })
      }

      const call = await getActiveCallForAccount(account.id)
      return res.status(200).json({ call })
    }

    if (!sameOrigin(req)) {
      return res.status(403).json({ error: 'Origin check failed.' })
    }

    const body = bodyOf(req)
    if (!body) {
      return res.status(400).json({ error: 'Request body must be valid JSON.' })
    }

    if (req.method === 'POST') {
      const conversationId = normalizeUuid(body.conversationId)
      const clientCallId = normalizeUuid(body.clientCallId)
      const kind = normalizeCallKind(body.kind)

      if (!conversationId || !clientCallId || !kind) {
        return res.status(400).json({
          error: 'Valid conversationId, clientCallId, and audio/video kind are required.',
        })
      }

      try {
        const result = await createCall({
          accountId: account.id,
          conversationId,
          clientCallId,
          kind,
        })

        return res
          .status(result.replayed ? 200 : 201)
          .json({ call: result.call })
      } catch (error) {
        if (error?.code === 'CALL_IDEMPOTENCY_CONFLICT') {
          return conflict(
            res,
            'CALL_IDEMPOTENCY_CONFLICT',
            'That clientCallId conflicts with an earlier call.',
          )
        }
        if (error?.code === 'CALL_BUSY') {
          return conflict(res, 'CALL_BUSY', 'That conversation already has an active call.')
        }
        if (error?.code === 'CONVERSATION_NOT_FOUND') {
          return res.status(404).json({ error: 'Conversation not found.' })
        }
        if (error?.code === 'INVALID_CALL_REQUEST') {
          return res.status(400).json({ error: 'Call request is invalid.' })
        }
        throw error
      }
    }

    const callId = normalizeUuid(body.callId)
    const action = normalizeCallAction(body.action)

    if (!callId || !action) {
      return res.status(400).json({
        error: 'Valid callId and call action are required.',
      })
    }

    try {
      const call = await transitionCall({
        accountId: account.id,
        callId,
        action,
      })

      return res.status(200).json({ call })
    } catch (error) {
      if (error?.code === 'CALL_NOT_FOUND') {
        return res.status(404).json({ error: 'Call not found.' })
      }
      if (error?.code === 'CALL_STATE_CONFLICT') {
        return conflict(
          res,
          'CALL_STATE_CONFLICT',
          'The call state no longer allows that action.',
        )
      }
      if (error?.code === 'INVALID_CALL_ACTION') {
        return res.status(400).json({ error: 'Call action is invalid.' })
      }
      throw error
    }
  } catch (error) {
    if (databaseNotConfigured(error)) {
      return res.status(503).json({ error: 'COMMS persistence is not connected yet.' })
    }

    console.error('comms calls api error', error)
    return res.status(500).json({ error: 'Call request failed.' })
  }
}
