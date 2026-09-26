import { neon } from '@neondatabase/serverless'
import { normalizeUuid } from './comms-db.js'
import { ensureCallSchema } from './comms-calls.js'

const SIGNAL_TYPES = new Set(['offer', 'answer', 'ice'])
const MAX_SDP_LENGTH = 131072
const MAX_CANDIDATE_LENGTH = 8192
const MAX_SIGNAL_PAGE = 100
const CURSOR_PATTERN = /^\d+$/

let signalSchemaPromise

function database() {
  if (!process.env.DATABASE_URL) {
    const error = new Error('DATABASE_URL is not configured.')
    error.code = 'DATABASE_NOT_CONFIGURED'
    throw error
  }

  return neon(process.env.DATABASE_URL)
}

function signalError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

function objectPayload(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : null
}

function hasOnlyKeys(value, allowed) {
  return Object.keys(value).every((key) => allowed.has(key))
}

function normalizeNullableString(value, maxLength) {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string' || value.length > maxLength) {
    throw signalError('INVALID_SIGNAL_PAYLOAD', 'Signal payload is invalid.')
  }
  return value
}

function normalizeSdpPayload(type, value) {
  const payload = objectPayload(value)
  if (!payload || !hasOnlyKeys(payload, new Set(['type', 'sdp']))) {
    throw signalError('INVALID_SIGNAL_PAYLOAD', 'Signal payload is invalid.')
  }

  if (
    payload.type !== type ||
    typeof payload.sdp !== 'string' ||
    payload.sdp.length < 1 ||
    payload.sdp.length > MAX_SDP_LENGTH
  ) {
    throw signalError('INVALID_SIGNAL_PAYLOAD', 'Signal payload is invalid.')
  }

  return {
    type,
    sdp: payload.sdp,
  }
}

function normalizeIcePayload(value) {
  const payload = objectPayload(value)
  const allowed = new Set([
    'candidate',
    'sdpMid',
    'sdpMLineIndex',
    'usernameFragment',
  ])

  if (!payload || !hasOnlyKeys(payload, allowed)) {
    throw signalError('INVALID_SIGNAL_PAYLOAD', 'Signal payload is invalid.')
  }

  if (
    typeof payload.candidate !== 'string' ||
    payload.candidate.length < 1 ||
    payload.candidate.length > MAX_CANDIDATE_LENGTH
  ) {
    throw signalError('INVALID_SIGNAL_PAYLOAD', 'Signal payload is invalid.')
  }

  const sdpMid = normalizeNullableString(payload.sdpMid, 256)
  const usernameFragment = normalizeNullableString(payload.usernameFragment, 256)

  let sdpMLineIndex = null
  if (payload.sdpMLineIndex !== null && payload.sdpMLineIndex !== undefined) {
    if (
      !Number.isInteger(payload.sdpMLineIndex) ||
      payload.sdpMLineIndex < 0 ||
      payload.sdpMLineIndex > 65535
    ) {
      throw signalError('INVALID_SIGNAL_PAYLOAD', 'Signal payload is invalid.')
    }
    sdpMLineIndex = payload.sdpMLineIndex
  }

  return {
    candidate: payload.candidate,
    sdpMid,
    sdpMLineIndex,
    usernameFragment,
  }
}

export function normalizeSignalType(value) {
  if (typeof value !== 'string') return ''
  const type = value.trim().toLowerCase()
  return SIGNAL_TYPES.has(type) ? type : ''
}

export function normalizeSignalCursor(value) {
  if (value === '' || value === undefined || value === null) return '0'
  if (typeof value !== 'string' || !CURSOR_PATTERN.test(value)) return ''
  return value.replace(/^0+(?=\d)/, '')
}

export function normalizeSignalPayload(type, value) {
  if (type === 'offer' || type === 'answer') {
    return normalizeSdpPayload(type, value)
  }
  if (type === 'ice') {
    return normalizeIcePayload(value)
  }
  throw signalError('INVALID_SIGNAL_PAYLOAD', 'Signal payload is invalid.')
}

function publicSignal(row) {
  return {
    sequence: String(row.sequence),
    senderAccountId: row.sender_account_id,
    type: row.signal_type,
    payload: row.payload,
    createdAt: row.created_at,
  }
}

export async function ensureSignalSchema() {
  await ensureCallSchema()

  if (!signalSchemaPromise) {
    signalSchemaPromise = (async () => {
      const sql = database()

      await sql`
        CREATE TABLE IF NOT EXISTS wildcard_call_signals (
          sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          call_id uuid NOT NULL
            REFERENCES wildcard_calls(id) ON DELETE CASCADE,
          sender_account_id uuid NOT NULL
            REFERENCES wildcard_accounts(id) ON DELETE CASCADE,
          client_signal_id uuid NOT NULL,
          signal_type varchar(8) NOT NULL
            CHECK (signal_type IN ('offer', 'answer', 'ice')),
          payload jsonb NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now(),
          UNIQUE (sender_account_id, client_signal_id)
        )
      `

      await sql`
        CREATE INDEX IF NOT EXISTS wildcard_call_signals_call_sequence_idx
        ON wildcard_call_signals (call_id, sequence)
      `

      await sql`
        CREATE UNIQUE INDEX IF NOT EXISTS wildcard_call_signals_one_offer
        ON wildcard_call_signals (call_id)
        WHERE signal_type = 'offer'
      `

      await sql`
        CREATE UNIQUE INDEX IF NOT EXISTS wildcard_call_signals_one_answer
        ON wildcard_call_signals (call_id)
        WHERE signal_type = 'answer'
      `
    })().catch((error) => {
      signalSchemaPromise = null
      throw error
    })
  }

  return signalSchemaPromise
}

async function cleanupOldSignals() {
  const sql = database()
  await sql`
    DELETE FROM wildcard_call_signals
    WHERE created_at < now() - interval '24 hours'
  `
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

  if (!row) return null
  if (row.status !== 'accepted') {
    throw signalError(
      'SIGNAL_STATE_CONFLICT',
      'Signals are only available for an accepted call.',
    )
  }

  return row
}

async function existingSignalForClient(accountId, clientSignalId, payload) {
  const sql = database()
  const currentId = normalizeUuid(accountId)
  const currentClientSignalId = normalizeUuid(clientSignalId)
  if (!currentId || !currentClientSignalId) return null

  const payloadJson = JSON.stringify(payload)
  const [row] = await sql`
    SELECT
      sequence,
      call_id,
      sender_account_id,
      client_signal_id,
      signal_type,
      payload,
      created_at,
      (payload = ${payloadJson}::jsonb) AS payload_matches
    FROM wildcard_call_signals
    WHERE sender_account_id = ${currentId}::uuid
      AND client_signal_id = ${currentClientSignalId}::uuid
    LIMIT 1
  `

  return row || null
}

async function signalExists(callId, type) {
  const sql = database()
  const [row] = await sql`
    SELECT sequence
    FROM wildcard_call_signals
    WHERE call_id = ${callId}::uuid
      AND signal_type = ${type}
    LIMIT 1
  `
  return Boolean(row?.sequence)
}

function enforceRole(call, accountId, type) {
  if (type === 'offer' && call.caller_account_id !== accountId) {
    throw signalError('SIGNAL_STATE_CONFLICT', 'Only the caller may create the offer.')
  }

  if (type === 'answer' && call.callee_account_id !== accountId) {
    throw signalError('SIGNAL_STATE_CONFLICT', 'Only the callee may create the answer.')
  }
}

async function enforceOrder(call, accountId, type) {
  if (type === 'offer') return

  const offerExists = await signalExists(call.id, 'offer')
  if (!offerExists) {
    throw signalError('SIGNAL_STATE_CONFLICT', 'An offer must exist before this signal.')
  }

  if (type === 'answer') return

  if (accountId === call.callee_account_id) {
    const answerExists = await signalExists(call.id, 'answer')
    if (!answerExists) {
      throw signalError('SIGNAL_STATE_CONFLICT', 'The answer must exist before callee ICE.')
    }
  }
}

export async function createCallSignal({
  accountId,
  callId,
  clientSignalId,
  type,
  payload,
}) {
  await ensureSignalSchema()
  await cleanupOldSignals()

  const currentId = normalizeUuid(accountId)
  const currentCallId = normalizeUuid(callId)
  const currentClientSignalId = normalizeUuid(clientSignalId)
  const currentType = normalizeSignalType(type)

  if (!currentId || !currentCallId || !currentClientSignalId || !currentType) {
    throw signalError('INVALID_SIGNAL_REQUEST', 'Signal request is invalid.')
  }

  const normalizedPayload = normalizeSignalPayload(currentType, payload)
  const call = await authorizedAcceptedCall(currentId, currentCallId)
  if (!call) {
    throw signalError('CALL_NOT_FOUND', 'Call not found.')
  }

  enforceRole(call, currentId, currentType)

  const existing = await existingSignalForClient(
    currentId,
    currentClientSignalId,
    normalizedPayload,
  )

  if (existing) {
    if (
      existing.call_id !== currentCallId ||
      existing.signal_type !== currentType ||
      existing.payload_matches !== true
    ) {
      throw signalError(
        'SIGNAL_IDEMPOTENCY_CONFLICT',
        'That clientSignalId was already used for different signaling content.',
      )
    }

    return {
      signal: publicSignal(existing),
      replayed: true,
    }
  }

  await enforceOrder(call, currentId, currentType)

  const payloadJson = JSON.stringify(normalizedPayload)

  try {
    const [inserted] = await sqlForInsert({
      callId: currentCallId,
      senderAccountId: currentId,
      clientSignalId: currentClientSignalId,
      type: currentType,
      payloadJson,
    })

    if (!inserted?.sequence) {
      throw signalError('SIGNAL_STATE_CONFLICT', 'Signal could not be stored.')
    }

    return {
      signal: publicSignal(inserted),
      replayed: false,
    }
  } catch (error) {
    if (error?.code === '23505') {
      const racedExisting = await existingSignalForClient(
        currentId,
        currentClientSignalId,
        normalizedPayload,
      )

      if (racedExisting) {
        if (
          racedExisting.call_id === currentCallId &&
          racedExisting.signal_type === currentType &&
          racedExisting.payload_matches === true
        ) {
          return {
            signal: publicSignal(racedExisting),
            replayed: true,
          }
        }

        throw signalError(
          'SIGNAL_IDEMPOTENCY_CONFLICT',
          'That clientSignalId was already used for different signaling content.',
        )
      }

      throw signalError(
        'SIGNAL_STATE_CONFLICT',
        'The canonical offer/answer already exists for this call.',
      )
    }

    throw error
  }
}

async function sqlForInsert({
  callId,
  senderAccountId,
  clientSignalId,
  type,
  payloadJson,
}) {
  const sql = database()
  return sql`
    INSERT INTO wildcard_call_signals (
      call_id,
      sender_account_id,
      client_signal_id,
      signal_type,
      payload
    )
    VALUES (
      ${callId}::uuid,
      ${senderAccountId}::uuid,
      ${clientSignalId}::uuid,
      ${type},
      ${payloadJson}::jsonb
    )
    RETURNING
      sequence,
      call_id,
      sender_account_id,
      client_signal_id,
      signal_type,
      payload,
      created_at
  `
}

export async function listCallSignals({
  accountId,
  callId,
  after = '0',
}) {
  await ensureSignalSchema()
  await cleanupOldSignals()

  const currentId = normalizeUuid(accountId)
  const currentCallId = normalizeUuid(callId)
  const cursor = normalizeSignalCursor(after)

  if (!currentId || !currentCallId || !cursor) {
    throw signalError('INVALID_SIGNAL_REQUEST', 'Signal request is invalid.')
  }

  const call = await authorizedAcceptedCall(currentId, currentCallId)
  if (!call) {
    throw signalError('CALL_NOT_FOUND', 'Call not found.')
  }

  const rows = await database()`
    SELECT
      sequence,
      sender_account_id,
      signal_type,
      payload,
      created_at
    FROM wildcard_call_signals
    WHERE call_id = ${currentCallId}::uuid
      AND sequence > ${cursor}::bigint
    ORDER BY sequence ASC
    LIMIT ${MAX_SIGNAL_PAGE + 1}
  `

  const hasMore = rows.length > MAX_SIGNAL_PAGE
  const page = hasMore ? rows.slice(0, MAX_SIGNAL_PAGE) : rows
  const signals = page.map(publicSignal)
  const nextAfter = signals.length > 0
    ? signals[signals.length - 1].sequence
    : cursor

  return {
    signals,
    nextAfter,
    hasMore,
  }
}

export const SIGNAL_PAGE_SIZE = MAX_SIGNAL_PAGE
export const SIGNAL_SDP_MAX_LENGTH = MAX_SDP_LENGTH
export const SIGNAL_CANDIDATE_MAX_LENGTH = MAX_CANDIDATE_LENGTH
