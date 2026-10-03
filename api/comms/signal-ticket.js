import {
  currentAccount,
  databaseNotConfigured,
  sameOrigin,
} from '../../lib/auth-db.js'
import { normalizeUuid } from '../../lib/comms-db.js'
import { getCallForParticipant } from '../../lib/comms-calls.js'
import {
  createSignalTicket,
  SIGNAL_TICKET_TTL_SECONDS,
} from '../../lib/comms-signal-ticket.js'

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
      return res.status(401).json({ error: 'Sign in is required for COMMS calls.' })
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

    const callId = normalizeUuid(body.callId)
    if (!callId) {
      return res.status(400).json({ error: 'Valid callId is required.' })
    }

    const call = await getCallForParticipant(account.id, callId)
    if (!call) {
      return res.status(404).json({ error: 'Call not found.' })
    }

    if (call.status !== 'accepted') {
      return res.status(409).json({
        code: 'CALL_STATE_CONFLICT',
        error: 'Signaling is only available for an accepted call.',
      })
    }

    const role = call.callerAccountId === account.id ? 'caller' : 'callee'
    const signalUrl = typeof process.env.COMMS_SIGNAL_URL === 'string'
      ? process.env.COMMS_SIGNAL_URL.trim()
      : ''
    const secret = typeof process.env.COMMS_SIGNAL_SECRET === 'string'
      ? process.env.COMMS_SIGNAL_SECRET
      : ''

    if (!signalUrl || !secret) {
      return res.status(503).json({
        error: 'Realtime signaling is not configured yet.',
      })
    }

    const ticket = createSignalTicket({
      secret,
      accountId: account.id,
      callId,
      role,
      ttlSeconds: SIGNAL_TICKET_TTL_SECONDS,
    })

    return res.status(200).json({
      signalUrl,
      ticket,
    })
  } catch (error) {
    if (databaseNotConfigured(error)) {
      return res.status(503).json({ error: 'COMMS persistence is not connected yet.' })
    }

    console.error('comms signal-ticket api error', {
      code: error?.code || null,
      name: error?.name || null,
    })
    return res.status(500).json({ error: 'Signal-ticket request failed.' })
  }
}
