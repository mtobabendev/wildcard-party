import {
  currentAccount,
  databaseNotConfigured,
  sameOrigin,
} from '../../lib/auth-db.js'
import {
  conversationParticipantExists,
  normalizeUuid,
} from '../../lib/comms-db.js'
import { createAudioSignalTicket } from '../../lib/comms-audio-ticket.js'

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
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST')
      return res.status(405).json({ error: 'Method not allowed.' })
    }

    if (!sameOrigin(req)) {
      return res.status(403).json({ error: 'Origin check failed.' })
    }

    const account = await currentAccount(req)
    if (!account) {
      return res.status(401).json({ error: 'Sign in is required for COMMS.' })
    }

    const body = bodyOf(req)
    if (!body) {
      return res.status(400).json({ error: 'Request body must be valid JSON.' })
    }

    const conversationId = normalizeUuid(body.conversationId)
    if (!conversationId) {
      return res.status(400).json({ error: 'A valid conversationId is required.' })
    }

    const participates = await conversationParticipantExists(account.id, conversationId)
    if (!participates) {
      return res.status(404).json({ error: 'Conversation not found.' })
    }

    const secret = process.env.COMMS_AUDIO_SIGNAL_SECRET
    const relayUrl = process.env.COMMS_AUDIO_SIGNAL_URL
    if (!secret || !relayUrl) {
      return res.status(503).json({ error: 'Audio signaling is not configured.' })
    }

    const ticket = createAudioSignalTicket({
      accountId: account.id,
      conversationId,
      secret,
    })

    return res.status(200).json({ ticket, relayUrl })
  } catch (error) {
    if (databaseNotConfigured(error)) {
      return res.status(503).json({ error: 'COMMS persistence is not connected yet.' })
    }

    console.error('comms audio signal ticket api error', error)
    return res.status(500).json({ error: 'Audio signaling ticket request failed.' })
  }
}
