import { DurableObject } from 'cloudflare:workers'

const ALLOWED_TYPES = new Set([
  'invite',
  'accept',
  'decline',
  'offer',
  'answer',
  'ice',
  'hangup',
])
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

function base64UrlBytes(value) {
  const padded = value
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(value.length / 4) * 4, '=')
  const binary = atob(padded)
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

async function verifyTicket(ticket, secret) {
  if (typeof ticket !== 'string' || !ticket || !secret) return null

  const parts = ticket.split('.')
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null

  try {
    const key = await crypto.subtle.importKey(
      'raw',
      textEncoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify'],
    )
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      base64UrlBytes(parts[1]),
      textEncoder.encode(parts[0]),
    )
    if (!valid) return null

    const payload = JSON.parse(textDecoder.decode(base64UrlBytes(parts[0])))
    if (!UUID_PATTERN.test(payload?.accountId || '')) return null
    if (!UUID_PATTERN.test(payload?.conversationId || '')) return null
    if (!Number.isInteger(payload?.exp) || payload.exp <= Math.floor(Date.now() / 1000)) {
      return null
    }

    return {
      accountId: payload.accountId.toLowerCase(),
      conversationId: payload.conversationId.toLowerCase(),
    }
  } catch {
    return null
  }
}

export class AudioSignalRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env)
    this.ctx = ctx
  }

  async fetch(request) {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('WebSocket upgrade required.', { status: 426 })
    }

    const accountId = request.headers.get('X-Audio-Account-Id')
    if (!UUID_PATTERN.test(accountId || '')) {
      return new Response('Unauthorized.', { status: 401 })
    }

    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair)
    this.ctx.acceptWebSocket(server)
    server.serializeAttachment({ accountId: accountId.toLowerCase() })

    return new Response(null, { status: 101, webSocket: client })
  }

  webSocketMessage(socket, message) {
    if (typeof message !== 'string') return

    let signal
    try {
      signal = JSON.parse(message)
    } catch {
      return
    }

    if (!ALLOWED_TYPES.has(signal?.type)) return
    if (!UUID_PATTERN.test(signal?.callId || '')) return

    const sender = socket.deserializeAttachment()
    if (!UUID_PATTERN.test(sender?.accountId || '')) return

    const forwarded = JSON.stringify({
      type: signal.type,
      callId: signal.callId.toLowerCase(),
      ...(signal.payload === undefined ? {} : { payload: signal.payload }),
      senderAccountId: sender.accountId,
    })

    for (const peer of this.ctx.getWebSockets()) {
      const identity = peer.deserializeAttachment()
      if (!identity?.accountId || identity.accountId === sender.accountId) continue

      try {
        peer.send(forwarded)
      } catch {
        // Cloudflare will discard sockets that are no longer usable.
      }
    }
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (url.pathname !== '/ws') {
      return new Response('WildCard Party audio signaling relay.')
    }

    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('WebSocket upgrade required.', { status: 426 })
    }

    const verified = await verifyTicket(
      url.searchParams.get('ticket'),
      env.COMMS_AUDIO_SIGNAL_SECRET,
    )
    if (!verified) {
      return new Response('Unauthorized.', { status: 401 })
    }

    const headers = new Headers(request.headers)
    headers.set('X-Audio-Account-Id', verified.accountId)

    const room = env.AUDIO_SIGNAL_ROOM.getByName(verified.conversationId)
    return room.fetch(new Request(request, { headers }))
  },
}
