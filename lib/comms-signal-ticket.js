import { createHmac, timingSafeEqual } from 'node:crypto'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SIGNAL_ROLES = new Set(['caller', 'callee'])
export const SIGNAL_TICKET_TTL_SECONDS = 90

function ticketError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

function validUuid(value) {
  return typeof value === 'string' && UUID_PATTERN.test(value)
}

function encodeJson(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')
}

function signPayload(encodedPayload, secret) {
  return createHmac('sha256', secret)
    .update(encodedPayload)
    .digest('base64url')
}

export function createSignalTicket({
  secret,
  accountId,
  callId,
  role,
  now = Math.floor(Date.now() / 1000),
  ttlSeconds = SIGNAL_TICKET_TTL_SECONDS,
}) {
  if (
    typeof secret !== 'string' ||
    !secret ||
    !validUuid(accountId) ||
    !validUuid(callId) ||
    !SIGNAL_ROLES.has(role) ||
    !Number.isInteger(ttlSeconds) ||
    ttlSeconds < 1 ||
    ttlSeconds > 300
  ) {
    throw ticketError('INVALID_SIGNAL_TICKET_REQUEST', 'Signal-ticket request is invalid.')
  }

  const payload = {
    accountId: accountId.toLowerCase(),
    callId: callId.toLowerCase(),
    role,
    exp: now + ttlSeconds,
  }

  const encodedPayload = encodeJson(payload)
  const signature = signPayload(encodedPayload, secret)

  return `${encodedPayload}.${signature}`
}

export function verifySignalTicket(
  ticket,
  {
    secret,
    now = Math.floor(Date.now() / 1000),
  },
) {
  if (typeof secret !== 'string' || !secret || typeof ticket !== 'string') {
    throw ticketError('INVALID_SIGNAL_TICKET', 'Signal ticket is invalid.')
  }

  const parts = ticket.split('.')
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw ticketError('INVALID_SIGNAL_TICKET', 'Signal ticket is invalid.')
  }

  const [encodedPayload, receivedSignature] = parts
  const expectedSignature = signPayload(encodedPayload, secret)

  let receivedBuffer
  let expectedBuffer

  try {
    receivedBuffer = Buffer.from(receivedSignature, 'base64url')
    expectedBuffer = Buffer.from(expectedSignature, 'base64url')
  } catch {
    throw ticketError('INVALID_SIGNAL_TICKET', 'Signal ticket is invalid.')
  }

  if (
    receivedBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(receivedBuffer, expectedBuffer)
  ) {
    throw ticketError('INVALID_SIGNAL_TICKET_SIGNATURE', 'Signal ticket signature is invalid.')
  }

  let payload
  try {
    payload = JSON.parse(
      Buffer.from(encodedPayload, 'base64url').toString('utf8'),
    )
  } catch {
    throw ticketError('INVALID_SIGNAL_TICKET', 'Signal ticket is invalid.')
  }

  const keys = Object.keys(payload || {})
  if (
    !payload ||
    keys.length !== 4 ||
    !keys.every((key) => ['accountId', 'callId', 'role', 'exp'].includes(key)) ||
    !validUuid(payload.accountId) ||
    !validUuid(payload.callId) ||
    !SIGNAL_ROLES.has(payload.role) ||
    !Number.isInteger(payload.exp)
  ) {
    throw ticketError('INVALID_SIGNAL_TICKET', 'Signal ticket payload is invalid.')
  }

  if (payload.exp <= now) {
    throw ticketError('SIGNAL_TICKET_EXPIRED', 'Signal ticket has expired.')
  }

  return {
    accountId: payload.accountId.toLowerCase(),
    callId: payload.callId.toLowerCase(),
    role: payload.role,
    exp: payload.exp,
  }
}
