import { upgradeWebSocket } from '@neon/functions'
import { neon } from '@neondatabase/serverless'
import { verifySignalTicket } from '../lib/comms-signal-ticket.js'

const RELAY_RETENTION_SECONDS = 120
const RELAY_POLL_MS = 250
const HEARTBEAT_MS = 25000
const MAX_SDP_LENGTH = 131072
const MAX_CANDIDATE_LENGTH = 8192
const ALLOWED_EVENTS = new Set([
  'offer',
  'answer',
  'ice-candidate',
  'call-end',
])

let sqlClient
let schemaPromise

function database() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not configured.')
  }

  if (!sqlClient) {
    sqlClient = neon(process.env.DATABASE_URL)
  }

  return sqlClient
}

function ensureRelaySchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      const sql = database()

      await sql`
        CREATE TABLE IF NOT EXISTS wildcard_signal_relay (
          id bigserial PRIMARY KEY,
          call_id uuid NOT NULL,
          sender_account_id uuid NOT NULL,
          sender_role text NOT NULL
            CHECK (sender_role IN ('caller', 'callee')),
          event_type text NOT NULL
            CHECK (event_type IN ('offer', 'answer', 'ice-candidate', 'call-end')),
          payload jsonb NULL,
          created_at timestamptz NOT NULL DEFAULT now()
        )
      `

      await sql`
        CREATE INDEX IF NOT EXISTS wildcard_signal_relay_call_id_id_idx
        ON wildcard_signal_relay (call_id, id)
      `
    })().catch((error) => {
      schemaPromise = null
      throw error
    })
  }

  return schemaPromise
}

function validDescription(value, expectedType) {
  return Boolean(
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).every((key) => ['type', 'sdp'].includes(key)) &&
    value.type === expectedType &&
    typeof value.sdp === 'string' &&
    value.sdp.length >= 1 &&
    value.sdp.length <= MAX_SDP_LENGTH
  )
}

function validCandidate(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false

  const allowedKeys = new Set([
    'candidate',
    'sdpMid',
    'sdpMLineIndex',
    'usernameFragment',
  ])

  if (Object.keys(value).some((key) => !allowedKeys.has(key))) return false

  if (
    typeof value.candidate !== 'string' ||
    value.candidate.length < 1 ||
    value.candidate.length > MAX_CANDIDATE_LENGTH
  ) {
    return false
  }

  if (
    value.sdpMid !== null &&
    value.sdpMid !== undefined &&
    (typeof value.sdpMid !== 'string' || value.sdpMid.length > 256)
  ) {
    return false
  }

  if (
    value.usernameFragment !== null &&
    value.usernameFragment !== undefined &&
    (
      typeof value.usernameFragment !== 'string' ||
      value.usernameFragment.length > 256
    )
  ) {
    return false
  }

  if (
    value.sdpMLineIndex !== null &&
    value.sdpMLineIndex !== undefined &&
    (
      !Number.isInteger(value.sdpMLineIndex) ||
      value.sdpMLineIndex < 0 ||
      value.sdpMLineIndex > 65535
    )
  ) {
    return false
  }

  return true
}

function normalizeSignalMessage(value, role) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  if (typeof value.type !== 'string' || !ALLOWED_EVENTS.has(value.type)) return null

  if (value.type === 'offer') {
    if (role !== 'caller' || !validDescription(value.payload, 'offer')) return null
    return { type: 'offer', payload: value.payload }
  }

  if (value.type === 'answer') {
    if (role !== 'callee' || !validDescription(value.payload, 'answer')) return null
    return { type: 'answer', payload: value.payload }
  }

  if (value.type === 'ice-candidate') {
    if (!validCandidate(value.payload)) return null
    return { type: 'ice-candidate', payload: value.payload }
  }

  if (value.type === 'call-end') {
    if (value.payload !== undefined && value.payload !== null) return null
    return { type: 'call-end', payload: null }
  }

  return null
}

async function deleteExpiredRows(sql) {
  await sql`
    DELETE FROM wildcard_signal_relay
    WHERE created_at < now() - interval '2 minutes'
  `
}

async function insertRelayRow(sql, identity, message) {
  const payloadJson = message.payload === null
    ? null
    : JSON.stringify(message.payload)

  await sql`
    INSERT INTO wildcard_signal_relay (
      call_id,
      sender_account_id,
      sender_role,
      event_type,
      payload
    )
    VALUES (
      ${identity.callId}::uuid,
      ${identity.accountId}::uuid,
      ${identity.role},
      ${message.type},
      ${payloadJson}::jsonb
    )
  `
}

async function readRelayRows(sql, identity, cursor) {
  return sql`
    SELECT
      id,
      event_type,
      payload
    FROM wildcard_signal_relay
    WHERE call_id = ${identity.callId}::uuid
      AND id > ${cursor}::bigint
      AND sender_account_id <> ${identity.accountId}::uuid
      AND created_at >= now() - interval '2 minutes'
    ORDER BY id ASC
    LIMIT 100
  `
}

function jsonEvent(row) {
  if (row.event_type === 'call-end') {
    return JSON.stringify({ type: 'call-end' })
  }

  return JSON.stringify({
    type: row.event_type,
    payload: row.payload,
  })
}

export default {
  async fetch(request) {
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('WebSocket endpoint', { status: 426 })
    }

    const secret = process.env.COMMS_SIGNAL_SECRET || ''
    if (!secret) {
      return new Response('Realtime signaling is not configured.', {
        status: 503,
      })
    }

    const url = new URL(request.url)
    const ticket = url.searchParams.get('ticket')

    let identity
    try {
      identity = verifySignalTicket(ticket, { secret })
    } catch {
      return new Response('Unauthorized', { status: 401 })
    }

    await ensureRelaySchema()
    const sql = database()
    await deleteExpiredRows(sql)

    const { socket, response } = upgradeWebSocket(request)

    let cursor = '0'
    let closed = false
    let reading = false
    let pollTimer = null
    let heartbeatTimer = null

    const stopTimers = () => {
      if (pollTimer) clearInterval(pollTimer)
      if (heartbeatTimer) clearInterval(heartbeatTimer)
      pollTimer = null
      heartbeatTimer = null
    }

    const pollRelay = async () => {
      if (closed || reading || socket.readyState !== 1) return

      reading = true
      try {
        const rows = await readRelayRows(sql, identity, cursor)

        for (const row of rows) {
          if (closed || socket.readyState !== 1) break
          socket.send(jsonEvent(row))
          cursor = String(row.id)
        }
      } catch {
        // A later bounded tick retries while the socket remains open.
      } finally {
        reading = false
      }
    }

    socket.addEventListener('open', () => {
      pollRelay()
      pollTimer = setInterval(pollRelay, RELAY_POLL_MS)

      heartbeatTimer = setInterval(() => {
        if (!closed && socket.readyState === 1) {
          socket.send('{"type":"ping"}')
        }
      }, HEARTBEAT_MS)

      pollTimer.unref?.()
      heartbeatTimer.unref?.()
    })

    socket.addEventListener('message', async (event) => {
      if (closed || typeof event.data !== 'string') return

      let parsed
      try {
        parsed = JSON.parse(event.data)
      } catch {
        return
      }

      const message = normalizeSignalMessage(parsed, identity.role)
      if (!message) return

      try {
        await insertRelayRow(sql, identity, message)
        await deleteExpiredRows(sql)
      } catch {
        // Invalid/unavailable relay storage does not expose internals to client.
      }
    })

    socket.addEventListener('close', () => {
      closed = true
      stopTimers()
    })

    socket.addEventListener('error', () => {
      if (socket.readyState === 3) {
        closed = true
        stopTimers()
      }
    })

    return response
  },
}
