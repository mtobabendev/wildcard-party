import {
  currentAccount,
  databaseNotConfigured,
  sameOrigin,
} from '../../lib/auth-db.js'
import {
  conversationParticipantExists,
  normalizeUuid,
} from '../../lib/comms-db.js'
import {
  createAttachmentUpload,
  isAllowedAttachmentType,
  MAX_ATTACHMENT_BYTES,
  sanitizeAttachmentName,
} from '../../lib/comms-storage.js'

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
    const account = await currentAccount(req)
    if (!account) {
      return res.status(401).json({ error: 'Sign in is required for COMMS.' })
    }

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST')
      return res.status(405).json({ error: 'Method not allowed.' })
    }

    if (!sameOrigin(req)) {
      return res.status(403).json({ error: 'Origin check failed.' })
    }

    const body = bodyOf(req)
    if (!body) {
      return res.status(400).json({ error: 'Request body must be valid JSON.' })
    }

    const conversationId = normalizeUuid(body.conversationId)
    const originalName = sanitizeAttachmentName(body.originalName)
    const contentType = typeof body.contentType === 'string'
      ? body.contentType.toLowerCase()
      : ''
    const byteSize = Number(body.byteSize)

    if (!conversationId) {
      return res.status(400).json({ error: 'A valid conversationId is required.' })
    }

    if (!isAllowedAttachmentType(contentType)) {
      return res.status(400).json({ error: 'That attachment type is not supported.' })
    }

    if (!Number.isSafeInteger(byteSize) || byteSize < 1 || byteSize > MAX_ATTACHMENT_BYTES) {
      return res.status(400).json({ error: 'Attachments must be between 1 byte and 10 MiB.' })
    }

    const authorized = await conversationParticipantExists(account.id, conversationId)
    if (!authorized) {
      return res.status(404).json({ error: 'Conversation not found.' })
    }

    const upload = await createAttachmentUpload({
      conversationId,
      accountId: account.id,
      originalName,
      contentType,
    })

    return res.status(200).json({ upload })
  } catch (error) {
    if (databaseNotConfigured(error)) {
      return res.status(503).json({ error: 'COMMS persistence is not connected yet.' })
    }

    if (error?.code === 'STORAGE_NOT_CONFIGURED') {
      return res.status(503).json({ error: 'Private COMMS storage is not configured for this runtime.' })
    }

    console.error('comms attachment upload authorization error', error)
    return res.status(500).json({ error: 'Attachment upload could not be authorized.' })
  }
}
