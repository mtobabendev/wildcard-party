import { createHmac } from 'node:crypto'

export const AUDIO_SIGNAL_TICKET_LIFETIME_SECONDS = 90

function sign(encodedPayload, secret) {
  return createHmac('sha256', secret).update(encodedPayload).digest('base64url')
}

export function createAudioSignalTicket({ accountId, conversationId, secret }) {
  if (!secret) {
    throw new Error('COMMS_AUDIO_SIGNAL_SECRET is not configured.')
  }

  const payload = {
    accountId,
    conversationId,
    exp: Math.floor(Date.now() / 1000) + AUDIO_SIGNAL_TICKET_LIFETIME_SECONDS,
  }

  const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  return `${encodedPayload}.${sign(encodedPayload, secret)}`
}
