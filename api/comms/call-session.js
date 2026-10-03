import {
  currentAccount,
  databaseNotConfigured,
  sameOrigin,
} from '../../lib/auth-db.js'
import { normalizeUuid } from '../../lib/comms-db.js'
import {
  getCallSession,
  normalizeCallSessionType,
  storeCallSessionDescription,
} from '../../lib/comms-call-session.js'

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

    if (!['GET', 'POST'].includes(req.method)) {
      res.setHeader('Allow', 'GET, POST')
      return res.status(405).json({ error: 'Method not allowed.' })
    }

    if (req.method === 'GET') {
      const callId = normalizeUuid(queryValue(req.query?.callId))
      if (!callId) {
        return res.status(400).json({ error: 'Valid callId is required.' })
      }

      try {
        const result = await getCallSession({
          accountId: account.id,
          callId,
        })

        return res.status(200).json(result)
      } catch (error) {
        if (error?.code === 'CALL_NOT_FOUND') {
          return res.status(404).json({ error: 'Call not found.' })
        }
        if (error?.code === 'CALL_SESSION_STATE_CONFLICT') {
          return conflict(res, 'CALL_SESSION_STATE_CONFLICT', error.message)
        }
        if (error?.code === 'INVALID_CALL_SESSION_REQUEST') {
          return res.status(400).json({ error: 'Call-session request is invalid.' })
        }
        throw error
      }
    }

    if (!sameOrigin(req)) {
      return res.status(403).json({ error: 'Origin check failed.' })
    }

    const body = bodyOf(req)
    if (!body) {
      return res.status(400).json({ error: 'Request body must be valid JSON.' })
    }

    const callId = normalizeUuid(body.callId)
    const type = normalizeCallSessionType(body.type)

    if (!callId || !type) {
      return res.status(400).json({
        error: 'Valid callId and offer/answer type are required.',
      })
    }

    try {
      const result = await storeCallSessionDescription({
        accountId: account.id,
        callId,
        type,
        payload: body.payload,
      })

      return res.status(200).json(result)
    } catch (error) {
      if (error?.code === 'CALL_NOT_FOUND') {
        return res.status(404).json({ error: 'Call not found.' })
      }
      if (error?.code === 'CALL_SESSION_CONFLICT') {
        return conflict(res, 'CALL_SESSION_CONFLICT', error.message)
      }
      if (error?.code === 'CALL_SESSION_STATE_CONFLICT') {
        return conflict(res, 'CALL_SESSION_STATE_CONFLICT', error.message)
      }
      if (error?.code === 'INVALID_CALL_SESSION_PAYLOAD') {
        return res.status(400).json({ error: 'Call-session payload is invalid.' })
      }
      if (error?.code === 'INVALID_CALL_SESSION_REQUEST') {
        return res.status(400).json({ error: 'Call-session request is invalid.' })
      }
      throw error
    }
  } catch (error) {
    if (databaseNotConfigured(error)) {
      return res.status(503).json({ error: 'COMMS persistence is not connected yet.' })
    }

    console.error('comms call-session api error', {
      code: error?.code || null,
      name: error?.name || null,
    })
    return res.status(500).json({ error: 'Call-session request failed.' })
  }
}
