import {
  currentAccount,
  databaseNotConfigured,
} from '../../lib/auth-db.js'
import {
  getAttachmentForParticipant,
  normalizeUuid,
} from '../../lib/comms-db.js'
import { createAttachmentDownload } from '../../lib/comms-storage.js'

function queryValue(value) {
  return typeof value === 'string' ? value : ''
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')

  try {
    const account = await currentAccount(req)
    if (!account) {
      return res.status(401).json({ error: 'Sign in is required for COMMS.' })
    }

    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET')
      return res.status(405).json({ error: 'Method not allowed.' })
    }

    const attachmentId = normalizeUuid(queryValue(req.query?.id))
    if (!attachmentId) {
      return res.status(404).json({ error: 'Attachment not found.' })
    }

    const attachment = await getAttachmentForParticipant(account.id, attachmentId)
    if (!attachment) {
      return res.status(404).json({ error: 'Attachment not found.' })
    }

    const download = await createAttachmentDownload({
      storageKey: attachment.storageKey,
      name: attachment.name,
      contentType: attachment.contentType,
    })

    res.statusCode = 302
    res.setHeader('Location', download.url)
    return res.end()
  } catch (error) {
    if (databaseNotConfigured(error)) {
      return res.status(503).json({ error: 'COMMS persistence is not connected yet.' })
    }

    if (error?.code === 'STORAGE_NOT_CONFIGURED') {
      return res.status(503).json({ error: 'Private COMMS storage is not configured for this runtime.' })
    }

    console.error('comms attachment download error', error)
    return res.status(500).json({ error: 'Attachment could not be opened.' })
  }
}
