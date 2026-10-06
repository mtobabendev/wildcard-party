import twilio from 'twilio'
import {
  currentAccount,
  databaseNotConfigured,
  sameOrigin,
} from '../../lib/auth-db.js'
import {
  acceptedCallForParticipant,
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

function roomNameForCall(callId) {
  return `wildcard-call-${callId}`
}

async function ensureRoom(client, roomName) {
  try {
    const room = await client.video.v1.rooms(roomName).fetch()
    if (room.status === 'completed') {
      const error = new Error('The Twilio Room for this call is already completed.')
      error.code = 'CALL_ROOM_COMPLETED'
      throw error
    }
    return room
  } catch (error) {
    if (error?.code !== 20404) throw error

    return client.video.v1.rooms.create({
      uniqueName: roomName,
      type: 'group',
      maxParticipants: 2,
      recordParticipantsOnConnect: false,
    })
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

    const callId = normalizeUuid(body.callId)
    if (!callId) {
      return res.status(400).json({ error: 'A valid callId is required.' })
    }

    const call = await acceptedCallForParticipant(account.id, callId)
    if (!call) {
      return res.status(404).json({ error: 'Accepted call not found.' })
    }

    const accountSid = process.env.TWILIO_ACCOUNT_SID
    const apiKey = process.env.TWILIO_API_KEY
    const apiSecret = process.env.TWILIO_API_SECRET

    if (!accountSid || !apiKey || !apiSecret) {
      return res.status(503).json({ error: 'Twilio Video is not configured.' })
    }

    const roomName = roomNameForCall(call.id)
    const client = twilio(apiKey, apiSecret, { accountSid })

    try {
      await ensureRoom(client, roomName)
    } catch (error) {
      console.error('twilio video room request failed', {
        code: error?.code,
        status: error?.status,
        message: error?.message,
      })
      return res.status(502).json({ error: 'Twilio Video Room creation failed.' })
    }

    const AccessToken = twilio.jwt.AccessToken
    const VideoGrant = AccessToken.VideoGrant
    const token = new AccessToken(accountSid, apiKey, apiSecret, {
      identity: account.id,
      ttl: 3600,
    })
    token.addGrant(new VideoGrant({ room: roomName }))

    return res.status(200).json({
      token: token.toJwt(),
      roomName,
      mode: call.mode,
    })
  } catch (error) {
    if (databaseNotConfigured(error)) {
      return res.status(503).json({ error: 'COMMS persistence is not connected yet.' })
    }

    console.error('comms video token api error', error)
    return res.status(500).json({ error: 'Video access token request failed.' })
  }
}
