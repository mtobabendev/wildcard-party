import { neon } from '@neondatabase/serverless'
import { normalizeUuid } from './comms-db.js'
import { ensureCallSchema } from './comms-calls.js'

const SESSION_TYPES = new Set(['offer', 'answer'])
const MAX_SDP_LENGTH = 131072

let callSessionSchemaPromise

function database() {
  if (!process.env.DATABASE_URL) {
    const error = new Error('DATABASE_URL is not configured.')
    error.code = 'DATABASE_NOT_CONFIGURED'
    throw error
  }

  return neon(process.env.DATABASE_URL)
}

function sessionError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

function objectPayload(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : null
}

export function normalizeCallSessionType(value) {
  if (typeof value !== 'string') return ''
  const type = value.trim().toLowerCase()
  return SESSION_TYPES.has(type) ? type : ''
}

export function normalizeCallSessionPayload(type, value) {
  const payload = objectPayload(value)
  if (
    !payload ||
    Object.keys(payload).some((key) => !['type', 'sdp'].includes(key)) ||
    payload.type !== type ||
    typeof payload.sdp !== 'string' ||
    payload.sdp.length < 1 ||
    payload.sdp.length > MAX_SDP_LENGTH
  ) {
    throw sessionError('INVALID_CALL_SESSION_PAYLOAD', 'Call-session payload is invalid.')
  }

  return {
    type,
    sdp: payload.sdp,
  }
}

function publicSession(row) {
  return {
    offer: row?.offer || null,
    answer: row?.answer || null,
    offerCreatedAt: row?.offer_created_at || null,
    answerCreatedAt: row?.answer_created_at || null,
    updatedAt: row?.updated_at || null,
  }
}

export async function ensureCallSessionSchema() {
  await ensureCallSchema()

  if (!callSessionSchemaPromise) {
    callSessionSchemaPromise = (async () => {
      const sql = database()

      await sql`
        CREATE TABLE IF NOT EXISTS wildcard_call_sessions (
          call_id uuid PRIMARY KEY
            REFERENCES wildcard_calls(id) ON DELETE CASCADE,
          offer jsonb NULL,
          answer jsonb NULL,
          offer_created_at timestamptz NULL,
          answer_created_at timestamptz NULL,
          updated_at timestamptz NOT NULL DEFAULT now(),
          CHECK (offer IS NULL OR jsonb_typeof(offer) = 'object'),
          CHECK (answer IS NULL OR jsonb_typeof(answer) = 'object'),
          CHECK (answer IS NULL OR offer IS NOT NULL)
        )
      `
    })().catch((error) => {
      callSessionSchemaPromise = null
      throw error
    })
  }

  return callSessionSchemaPromise
}

async function authorizedAcceptedCall(accountId, callId) {
  const sql = database()
  const currentId = normalizeUuid(accountId)
  const currentCallId = normalizeUuid(callId)

  if (!currentId || !currentCallId) return null

  const [row] = await sql`
    SELECT
      id,
      caller_account_id,
      callee_account_id,
      status
    FROM wildcard_calls
    WHERE id = ${currentCallId}::uuid
      AND (
        caller_account_id = ${currentId}::uuid
        OR callee_account_id = ${currentId}::uuid
      )
    LIMIT 1
  `

  if (!row) {
    throw sessionError('CALL_NOT_FOUND', 'Call not found.')
  }

  if (row.status !== 'accepted') {
    throw sessionError(
      'CALL_SESSION_STATE_CONFLICT',
      'Call negotiation is only available for an accepted call.',
    )
  }

  return row
}

async function selectSession(callId) {
  const sql = database()
  const currentCallId = normalizeUuid(callId)
  if (!currentCallId) return null

  const [row] = await sql`
    SELECT
      call_id,
      offer,
      answer,
      offer_created_at,
      answer_created_at,
      updated_at
    FROM wildcard_call_sessions
    WHERE call_id = ${currentCallId}::uuid
    LIMIT 1
  `

  return row || null
}

export async function getCallSession({ accountId, callId }) {
  await ensureCallSessionSchema()

  const currentCallId = normalizeUuid(callId)
  if (!currentCallId) {
    throw sessionError('INVALID_CALL_SESSION_REQUEST', 'Call-session request is invalid.')
  }

  await authorizedAcceptedCall(accountId, currentCallId)
  const row = await selectSession(currentCallId)

  return {
    session: publicSession(row),
  }
}

async function persistOffer(callId, payload) {
  const sql = database()
  const payloadJson = JSON.stringify(payload)

  const rows = await sql`
    INSERT INTO wildcard_call_sessions (
      call_id,
      offer,
      offer_created_at,
      updated_at
    )
    VALUES (
      ${callId}::uuid,
      ${payloadJson}::jsonb,
      now(),
      now()
    )
    ON CONFLICT (call_id) DO UPDATE
    SET
      offer = EXCLUDED.offer,
      offer_created_at = COALESCE(
        wildcard_call_sessions.offer_created_at,
        EXCLUDED.offer_created_at
      ),
      updated_at = CASE
        WHEN wildcard_call_sessions.offer IS NULL THEN now()
        ELSE wildcard_call_sessions.updated_at
      END
    WHERE
      wildcard_call_sessions.offer IS NULL
      OR wildcard_call_sessions.offer = EXCLUDED.offer
    RETURNING
      call_id,
      offer,
      answer,
      offer_created_at,
      answer_created_at,
      updated_at
  `

  if (rows.length) return rows[0]

  throw sessionError(
    'CALL_SESSION_CONFLICT',
    'A different canonical offer already exists for this call.',
  )
}

async function persistAnswer(callId, payload) {
  const sql = database()
  const payloadJson = JSON.stringify(payload)

  const rows = await sql`
    UPDATE wildcard_call_sessions
    SET
      answer = ${payloadJson}::jsonb,
      answer_created_at = COALESCE(answer_created_at, now()),
      updated_at = CASE
        WHEN answer IS NULL THEN now()
        ELSE updated_at
      END
    WHERE call_id = ${callId}::uuid
      AND offer IS NOT NULL
      AND (
        answer IS NULL
        OR answer = ${payloadJson}::jsonb
      )
    RETURNING
      call_id,
      offer,
      answer,
      offer_created_at,
      answer_created_at,
      updated_at
  `

  if (rows.length) return rows[0]

  const existing = await selectSession(callId)
  if (!existing?.offer) {
    throw sessionError(
      'CALL_SESSION_STATE_CONFLICT',
      'A canonical offer must exist before the answer can be stored.',
    )
  }

  throw sessionError(
    'CALL_SESSION_CONFLICT',
    'A different canonical answer already exists for this call.',
  )
}

export async function storeCallSessionDescription({
  accountId,
  callId,
  type,
  payload,
}) {
  await ensureCallSessionSchema()

  const currentId = normalizeUuid(accountId)
  const currentCallId = normalizeUuid(callId)
  const currentType = normalizeCallSessionType(type)

  if (!currentId || !currentCallId || !currentType) {
    throw sessionError('INVALID_CALL_SESSION_REQUEST', 'Call-session request is invalid.')
  }

  const normalizedPayload = normalizeCallSessionPayload(currentType, payload)
  const call = await authorizedAcceptedCall(currentId, currentCallId)

  if (currentType === 'offer' && call.caller_account_id !== currentId) {
    throw sessionError(
      'CALL_SESSION_STATE_CONFLICT',
      'Only the caller may store the canonical offer.',
    )
  }

  if (currentType === 'answer' && call.callee_account_id !== currentId) {
    throw sessionError(
      'CALL_SESSION_STATE_CONFLICT',
      'Only the callee may store the canonical answer.',
    )
  }

  const row = currentType === 'offer'
    ? await persistOffer(currentCallId, normalizedPayload)
    : await persistAnswer(currentCallId, normalizedPayload)

  return {
    session: publicSession(row),
  }
}
