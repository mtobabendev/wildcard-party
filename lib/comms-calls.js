import { randomUUID } from 'node:crypto'
import { neon } from '@neondatabase/serverless'
import { ensureCommsSchema, normalizeUuid } from './comms-db.js'

const CALL_KINDS = new Set(['audio', 'video'])
const CALL_ACTIONS = new Set(['accept', 'decline', 'cancel', 'end'])
const ACTIVE_STATUSES = new Set(['ringing', 'accepted'])
const TERMINAL_STATUSES = new Set(['declined', 'cancelled', 'ended', 'missed'])
const RING_TIMEOUT_SECONDS = 45

let callSchemaPromise

function database() {
  if (!process.env.DATABASE_URL) {
    const error = new Error('DATABASE_URL is not configured.')
    error.code = 'DATABASE_NOT_CONFIGURED'
    throw error
  }

  return neon(process.env.DATABASE_URL)
}

function publicAccount(row, prefix) {
  const id = row?.[`${prefix}_id`]
  if (!id) return null

  return {
    id,
    handle: row[`${prefix}_handle`],
    displayName: row[`${prefix}_display_name`],
  }
}

function publicCall(row, currentAccountId) {
  if (!row?.id) return null

  const currentId = normalizeUuid(currentAccountId)
  const otherPrefix = row.caller_account_id === currentId ? 'callee' : 'caller'

  return {
    id: row.id,
    conversationId: row.conversation_id,
    kind: row.kind,
    status: row.status,
    callerAccountId: row.caller_account_id,
    calleeAccountId: row.callee_account_id,
    otherAccount: publicAccount(row, otherPrefix),
    createdAt: row.created_at,
    answeredAt: row.answered_at || null,
    endedAt: row.ended_at || null,
    updatedAt: row.updated_at,
  }
}

export function normalizeCallKind(value) {
  if (typeof value !== 'string') return ''
  const kind = value.trim().toLowerCase()
  return CALL_KINDS.has(kind) ? kind : ''
}

export function normalizeCallAction(value) {
  if (typeof value !== 'string') return ''
  const action = value.trim().toLowerCase()
  return CALL_ACTIONS.has(action) ? action : ''
}

export function isTerminalCallStatus(value) {
  return TERMINAL_STATUSES.has(value)
}

export async function ensureCallSchema() {
  await ensureCommsSchema()

  if (!callSchemaPromise) {
    callSchemaPromise = (async () => {
      const sql = database()

      await sql`
        CREATE TABLE IF NOT EXISTS wildcard_calls (
          id uuid PRIMARY KEY,
          conversation_id uuid NOT NULL
            REFERENCES wildcard_conversations(id) ON DELETE CASCADE,
          caller_account_id uuid NOT NULL
            REFERENCES wildcard_accounts(id) ON DELETE CASCADE,
          callee_account_id uuid NOT NULL
            REFERENCES wildcard_accounts(id) ON DELETE CASCADE,
          client_call_id uuid NOT NULL,
          kind varchar(8) NOT NULL
            CHECK (kind IN ('audio', 'video')),
          status varchar(10) NOT NULL
            CHECK (status IN (
              'ringing',
              'accepted',
              'declined',
              'cancelled',
              'ended',
              'missed'
            )),
          created_at timestamptz NOT NULL DEFAULT now(),
          answered_at timestamptz NULL,
          ended_at timestamptz NULL,
          updated_at timestamptz NOT NULL DEFAULT now(),
          CHECK (caller_account_id <> callee_account_id),
          UNIQUE (caller_account_id, client_call_id)
        )
      `

      await sql`
        CREATE UNIQUE INDEX IF NOT EXISTS wildcard_calls_active_conversation_unique
        ON wildcard_calls (conversation_id)
        WHERE status IN ('ringing', 'accepted')
      `

      await sql`
        CREATE INDEX IF NOT EXISTS wildcard_calls_caller_active_idx
        ON wildcard_calls (caller_account_id, status, updated_at DESC)
      `

      await sql`
        CREATE INDEX IF NOT EXISTS wildcard_calls_callee_active_idx
        ON wildcard_calls (callee_account_id, status, updated_at DESC)
      `

      await sql`
        CREATE INDEX IF NOT EXISTS wildcard_calls_conversation_updated_idx
        ON wildcard_calls (conversation_id, updated_at DESC)
      `
    })().catch((error) => {
      callSchemaPromise = null
      throw error
    })
  }

  return callSchemaPromise
}

async function expireStaleCallsForAccount(accountId, callId = '') {
  await ensureCallSchema()
  const sql = database()
  const currentId = normalizeUuid(accountId)
  const currentCallId = callId ? normalizeUuid(callId) : ''

  if (!currentId) return

  if (currentCallId) {
    await sql`
      UPDATE wildcard_calls
      SET
        status = 'missed',
        ended_at = now(),
        updated_at = now()
      WHERE id = ${currentCallId}::uuid
        AND status = 'ringing'
        AND created_at <= now() - interval '45 seconds'
        AND (
          caller_account_id = ${currentId}::uuid
          OR callee_account_id = ${currentId}::uuid
        )
    `
    return
  }

  await sql`
    UPDATE wildcard_calls
    SET
      status = 'missed',
      ended_at = now(),
      updated_at = now()
    WHERE status = 'ringing'
      AND created_at <= now() - interval '45 seconds'
      AND (
        caller_account_id = ${currentId}::uuid
        OR callee_account_id = ${currentId}::uuid
      )
  `
}

async function selectCallForParticipant(accountId, callId) {
  const sql = database()
  const currentId = normalizeUuid(accountId)
  const currentCallId = normalizeUuid(callId)
  if (!currentId || !currentCallId) return null

  const [row] = await sql`
    SELECT
      call.id,
      call.conversation_id,
      call.caller_account_id,
      call.callee_account_id,
      call.client_call_id,
      call.kind,
      call.status,
      call.created_at,
      call.answered_at,
      call.ended_at,
      call.updated_at,
      caller.id AS caller_id,
      caller.handle AS caller_handle,
      caller.display_name AS caller_display_name,
      callee.id AS callee_id,
      callee.handle AS callee_handle,
      callee.display_name AS callee_display_name
    FROM wildcard_calls call
    JOIN wildcard_accounts caller
      ON caller.id = call.caller_account_id
    JOIN wildcard_accounts callee
      ON callee.id = call.callee_account_id
    WHERE call.id = ${currentCallId}::uuid
      AND (
        call.caller_account_id = ${currentId}::uuid
        OR call.callee_account_id = ${currentId}::uuid
      )
    LIMIT 1
  `

  return row || null
}

async function selectCallByClientId(accountId, clientCallId) {
  const sql = database()
  const currentId = normalizeUuid(accountId)
  const currentClientCallId = normalizeUuid(clientCallId)
  if (!currentId || !currentClientCallId) return null

  const [row] = await sql`
    SELECT
      call.id,
      call.conversation_id,
      call.caller_account_id,
      call.callee_account_id,
      call.client_call_id,
      call.kind,
      call.status,
      call.created_at,
      call.answered_at,
      call.ended_at,
      call.updated_at,
      caller.id AS caller_id,
      caller.handle AS caller_handle,
      caller.display_name AS caller_display_name,
      callee.id AS callee_id,
      callee.handle AS callee_handle,
      callee.display_name AS callee_display_name
    FROM wildcard_calls call
    JOIN wildcard_accounts caller
      ON caller.id = call.caller_account_id
    JOIN wildcard_accounts callee
      ON callee.id = call.callee_account_id
    WHERE call.caller_account_id = ${currentId}::uuid
      AND call.client_call_id = ${currentClientCallId}::uuid
    LIMIT 1
  `

  return row || null
}

export async function createCall({
  accountId,
  conversationId,
  clientCallId,
  kind,
}) {
  await ensureCallSchema()

  const sql = database()
  const callerId = normalizeUuid(accountId)
  const currentConversationId = normalizeUuid(conversationId)
  const currentClientCallId = normalizeUuid(clientCallId)
  const currentKind = normalizeCallKind(kind)

  if (!callerId || !currentConversationId || !currentClientCallId || !currentKind) {
    const error = new Error('Call identifiers are invalid.')
    error.code = 'INVALID_CALL_REQUEST'
    throw error
  }

  const existing = await selectCallByClientId(callerId, currentClientCallId)
  if (existing) {
    if (
      existing.conversation_id !== currentConversationId ||
      existing.kind !== currentKind
    ) {
      const error = new Error('That client call ID conflicts with an earlier call.')
      error.code = 'CALL_IDEMPOTENCY_CONFLICT'
      throw error
    }

    return {
      call: publicCall(existing, callerId),
      replayed: true,
    }
  }

  await sql`
    UPDATE wildcard_calls call
    SET
      status = 'missed',
      ended_at = now(),
      updated_at = now()
    WHERE call.conversation_id = ${currentConversationId}::uuid
      AND call.status = 'ringing'
      AND call.created_at <= now() - interval '45 seconds'
      AND EXISTS (
        SELECT 1
        FROM wildcard_conversations conversation
        WHERE conversation.id = call.conversation_id
          AND (
            conversation.account_a_id = ${callerId}::uuid
            OR conversation.account_b_id = ${callerId}::uuid
          )
      )
  `

  const callId = randomUUID()

  try {
    const [inserted] = await sql`
      INSERT INTO wildcard_calls (
        id,
        conversation_id,
        caller_account_id,
        callee_account_id,
        client_call_id,
        kind,
        status
      )
      SELECT
        ${callId},
        conversation.id,
        ${callerId}::uuid,
        CASE
          WHEN conversation.account_a_id = ${callerId}::uuid
            THEN conversation.account_b_id
          ELSE conversation.account_a_id
        END,
        ${currentClientCallId}::uuid,
        ${currentKind},
        'ringing'
      FROM wildcard_conversations conversation
      WHERE conversation.id = ${currentConversationId}::uuid
        AND (
          conversation.account_a_id = ${callerId}::uuid
          OR conversation.account_b_id = ${callerId}::uuid
        )
      RETURNING id
    `

    if (!inserted?.id) {
      const error = new Error('Conversation not found.')
      error.code = 'CONVERSATION_NOT_FOUND'
      throw error
    }
  } catch (error) {
    if (error?.code === '23505') {
      const racedExisting = await selectCallByClientId(callerId, currentClientCallId)
      if (racedExisting) {
        if (
          racedExisting.conversation_id !== currentConversationId ||
          racedExisting.kind !== currentKind
        ) {
          const conflict = new Error('That client call ID conflicts with an earlier call.')
          conflict.code = 'CALL_IDEMPOTENCY_CONFLICT'
          throw conflict
        }

        return {
          call: publicCall(racedExisting, callerId),
          replayed: true,
        }
      }

      const busy = new Error('This conversation already has an active call.')
      busy.code = 'CALL_BUSY'
      throw busy
    }

    throw error
  }

  const created = await selectCallForParticipant(callerId, callId)
  return {
    call: publicCall(created, callerId),
    replayed: false,
  }
}

export async function getActiveCallForAccount(accountId) {
  await ensureCallSchema()
  const sql = database()
  const currentId = normalizeUuid(accountId)
  if (!currentId) return null

  await expireStaleCallsForAccount(currentId)

  const rows = await sql`
    SELECT
      call.id,
      call.conversation_id,
      call.caller_account_id,
      call.callee_account_id,
      call.client_call_id,
      call.kind,
      call.status,
      call.created_at,
      call.answered_at,
      call.ended_at,
      call.updated_at,
      caller.id AS caller_id,
      caller.handle AS caller_handle,
      caller.display_name AS caller_display_name,
      callee.id AS callee_id,
      callee.handle AS callee_handle,
      callee.display_name AS callee_display_name
    FROM wildcard_calls call
    JOIN wildcard_accounts caller
      ON caller.id = call.caller_account_id
    JOIN wildcard_accounts callee
      ON callee.id = call.callee_account_id
    WHERE (
      call.caller_account_id = ${currentId}::uuid
      OR call.callee_account_id = ${currentId}::uuid
    )
      AND call.status IN ('ringing', 'accepted')
    ORDER BY
      CASE WHEN call.status = 'accepted' THEN 0 ELSE 1 END,
      call.updated_at DESC,
      call.id DESC
    LIMIT 2
  `

  if (rows.length > 1) {
    console.error('COMMS call integrity warning: multiple active calls for account', {
      accountId: currentId,
      callIds: rows.map((row) => row.id),
    })
  }

  return publicCall(rows[0], currentId)
}

export async function getCallForParticipant(accountId, callId) {
  await ensureCallSchema()
  const currentId = normalizeUuid(accountId)
  const currentCallId = normalizeUuid(callId)
  if (!currentId || !currentCallId) return null

  await expireStaleCallsForAccount(currentId, currentCallId)
  const row = await selectCallForParticipant(currentId, currentCallId)
  return publicCall(row, currentId)
}

export async function transitionCall({
  accountId,
  callId,
  action,
}) {
  await ensureCallSchema()

  const sql = database()
  const currentId = normalizeUuid(accountId)
  const currentCallId = normalizeUuid(callId)
  const currentAction = normalizeCallAction(action)

  if (!currentId || !currentCallId || !currentAction) {
    const error = new Error('Call action is invalid.')
    error.code = 'INVALID_CALL_ACTION'
    throw error
  }

  await expireStaleCallsForAccount(currentId, currentCallId)

  let updatedRows

  if (currentAction === 'accept') {
    updatedRows = await sql`
      UPDATE wildcard_calls
      SET
        status = 'accepted',
        answered_at = now(),
        updated_at = now()
      WHERE id = ${currentCallId}::uuid
        AND status = 'ringing'
        AND created_at > now() - interval '45 seconds'
        AND callee_account_id = ${currentId}::uuid
      RETURNING id
    `
  } else if (currentAction === 'decline') {
    updatedRows = await sql`
      UPDATE wildcard_calls
      SET
        status = 'declined',
        ended_at = now(),
        updated_at = now()
      WHERE id = ${currentCallId}::uuid
        AND status = 'ringing'
        AND created_at > now() - interval '45 seconds'
        AND callee_account_id = ${currentId}::uuid
      RETURNING id
    `
  } else if (currentAction === 'cancel') {
    updatedRows = await sql`
      UPDATE wildcard_calls
      SET
        status = 'cancelled',
        ended_at = now(),
        updated_at = now()
      WHERE id = ${currentCallId}::uuid
        AND status = 'ringing'
        AND created_at > now() - interval '45 seconds'
        AND caller_account_id = ${currentId}::uuid
      RETURNING id
    `
  } else {
    updatedRows = await sql`
      UPDATE wildcard_calls
      SET
        status = 'ended',
        ended_at = now(),
        updated_at = now()
      WHERE id = ${currentCallId}::uuid
        AND status = 'accepted'
        AND (
          caller_account_id = ${currentId}::uuid
          OR callee_account_id = ${currentId}::uuid
        )
      RETURNING id
    `
  }

  const canonical = await selectCallForParticipant(currentId, currentCallId)
  if (!canonical) {
    const error = new Error('Call not found.')
    error.code = 'CALL_NOT_FOUND'
    throw error
  }

  if (updatedRows.length > 0) {
    return publicCall(canonical, currentId)
  }

  const idempotent =
    (currentAction === 'accept' &&
      canonical.status === 'accepted' &&
      canonical.callee_account_id === currentId) ||
    (currentAction === 'decline' &&
      canonical.status === 'declined' &&
      canonical.callee_account_id === currentId) ||
    (currentAction === 'cancel' &&
      canonical.status === 'cancelled' &&
      canonical.caller_account_id === currentId) ||
    (currentAction === 'end' &&
      canonical.status === 'ended')

  if (idempotent) {
    return publicCall(canonical, currentId)
  }

  const error = new Error('The call state changed before this action could be applied.')
  error.code = 'CALL_STATE_CONFLICT'
  throw error
}

export const CALL_RING_TIMEOUT_SECONDS = RING_TIMEOUT_SECONDS
export const CALL_ACTIVE_STATUSES = ACTIVE_STATUSES
