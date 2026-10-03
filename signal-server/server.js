import http from 'node:http'
import { Server } from 'socket.io'
import { verifySignalTicket } from '../lib/comms-signal-ticket.js'

const PORT = Number.parseInt(process.env.PORT || '5050', 10)
const SIGNAL_SECRET = process.env.COMMS_SIGNAL_SECRET || ''
const MAX_SDP_LENGTH = 131072
const MAX_CANDIDATE_LENGTH = 8192

function socketError(code, message) {
  const error = new Error(message)
  error.data = { code }
  return error
}

function validDescription(value, type) {
  return Boolean(
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).every((key) => ['type', 'sdp'].includes(key)) &&
    value.type === type &&
    typeof value.sdp === 'string' &&
    value.sdp.length >= 1 &&
    value.sdp.length <= MAX_SDP_LENGTH
  )
}

function validCandidate(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false

  const allowed = new Set([
    'candidate',
    'sdpMid',
    'sdpMLineIndex',
    'usernameFragment',
  ])
  if (Object.keys(value).some((key) => !allowed.has(key))) return false

  if (
    typeof value.candidate !== 'string' ||
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

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true }))
    return
  }

  res.writeHead(404, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ error: 'Not found.' }))
})

const io = new Server(server, {
  cors: {
    origin: true,
    methods: ['GET', 'POST'],
    credentials: false,
  },
})

io.use((socket, next) => {
  if (!SIGNAL_SECRET) {
    next(socketError('SIGNAL_NOT_CONFIGURED', 'Realtime signaling is not configured.'))
    return
  }

  try {
    const identity = verifySignalTicket(socket.handshake.auth?.ticket, {
      secret: SIGNAL_SECRET,
    })

    socket.data.accountId = identity.accountId
    socket.data.callId = identity.callId
    socket.data.role = identity.role
    socket.data.room = `call:${identity.callId}`
    next()
  } catch (error) {
    next(socketError(error?.code || 'INVALID_SIGNAL_TICKET', error?.message || 'Signal ticket rejected.'))
  }
})

async function roomParticipants(room) {
  const sockets = await io.in(room).fetchSockets()
  return sockets.filter((current) => current.data?.room === room)
}

async function emitPeerReady(room) {
  const participants = await roomParticipants(room)
  const roles = new Set(participants.map((current) => current.data?.role))
  const accounts = new Set(participants.map((current) => current.data?.accountId))

  if (
    participants.length === 2 &&
    accounts.size === 2 &&
    roles.has('caller') &&
    roles.has('callee')
  ) {
    io.to(room).emit('peer-ready')
  }
}

io.on('connection', async (socket) => {
  const room = socket.data.room
  const accountId = socket.data.accountId
  const role = socket.data.role

  const existing = await roomParticipants(room)
  const duplicate = existing.find(
    (current) => current.data?.accountId === accountId,
  )

  if (duplicate) {
    duplicate.disconnect(true)
  }

  const distinctAccounts = new Set(
    existing
      .filter((current) => current.id !== duplicate?.id)
      .map((current) => current.data?.accountId),
  )

  if (distinctAccounts.size >= 2) {
    socket.emit('signal-error', { code: 'ROOM_FULL' })
    socket.disconnect(true)
    return
  }

  await socket.join(room)
  await emitPeerReady(room)

  socket.on('offer', (description) => {
    if (role !== 'caller' || !validDescription(description, 'offer')) return
    socket.to(room).emit('offer', description)
  })

  socket.on('answer', (description) => {
    if (role !== 'callee' || !validDescription(description, 'answer')) return
    socket.to(room).emit('answer', description)
  })

  socket.on('ice-candidate', (candidate) => {
    if (!validCandidate(candidate)) return
    socket.to(room).emit('ice-candidate', candidate)
  })

  socket.on('call-end', () => {
    socket.to(room).emit('call-end')
  })

  socket.on('disconnect', () => {
    // Socket.IO automatically removes disconnected sockets from rooms.
    // Durable wildcard_calls state remains owned by the Party application.
  })
})

server.listen(PORT, () => {
  console.log(`WildCard signaling relay listening on port ${PORT}`)
})
