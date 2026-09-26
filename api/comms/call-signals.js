import {
  currentAccount,
  databaseNotConfigured,
  sameOrigin,
} from '../../lib/auth-db.js'
import { normalizeUuid } from '../../lib/comms-db.js'
import {
  createCallSignal,
  listCallSignals,
  normalizeSignalCursor,
  normalizeSignalType,
} from '../../lib/comms-signals.js'

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

  let structuralCallId = ''
  let structuralSignalType = ''

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
      const after = normalizeSignalCursor(queryValue(req.query?.after))

      structuralCallId = callId

      if (!callId || !after) {
        return res.status(400).json({ error: 'Valid callId and decimal after cursor are required.' })
      }

      try {
        const result = await listCallSignals({
          accountId: account.id,
          callId,
          after,
        })

        return res.status(200).json(result)
      } catch (error) {
        if (error?.code === 'CALL_NOT_FOUND') {
          return res.status(404).json({ error: 'Call not found.' })
        }
        if (error?.code === 'SIGNAL_STATE_CONFLICT') {
          return conflict(res, 'SIGNAL_STATE_CONFLICT', error.message)
        }
        if (error?.code === 'INVALID_SIGNAL_REQUEST') {
          return res.status(400).json({ error: 'Signal request is invalid.' })
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
    const clientSignalId = normalizeUuid(body.clientSignalId)
    const type = normalizeSignalType(body.type)

    structuralCallId = callId
    structuralSignalType = type

    if (!callId || !clientSignalId || !type) {
      return res.status(400).json({
        error: 'Valid callId, clientSignalId, and signal type are required.',
      })
    }

    try {
      const result = await createCallSignal({
        accountId: account.id,
        callId,
        clientSignalId,
        type,
        payload: body.payload,
      })

      return res
        .status(result.replayed ? 200 : 201)
        .json({ signal: result.signal })
    } catch (error) {
      if (error?.code === 'CALL_NOT_FOUND') {
        return res.status(404).json({ error: 'Call not found.' })
      }
      if (error?.code === 'SIGNAL_IDEMPOTENCY_CONFLICT') {
        return conflict(
          res,
          'SIGNAL_IDEMPOTENCY_CONFLICT',
          'That clientSignalId conflicts with an earlier signal.',
        )
      }
      if (error?.code === 'SIGNAL_STATE_CONFLICT') {
        return conflict(res, 'SIGNAL_STATE_CONFLICT', error.message)
      }
      if (error?.code === 'INVALID_SIGNAL_PAYLOAD') {
        return res.status(400).json({ error: 'Signal payload is invalid.' })
      }
      if (error?.code === 'INVALID_SIGNAL_REQUEST') {
        return res.status(400).json({ error: 'Signal request is invalid.' })
      }
      throw error
    }
  } catch (error) {
    if (databaseNotConfigured(error)) {
      return res.status(503).json({ error: 'COMMS persistence is not connected yet.' })
    }

    console.error('comms call signaling error', {
      callId: structuralCallId || null,
      signalType: structuralSignalType || null,
      code: error?.code || null,
      name: error?.name || null,
    })
    return res.status(500).json({ error: 'Call signaling request failed.' })
  }
}
