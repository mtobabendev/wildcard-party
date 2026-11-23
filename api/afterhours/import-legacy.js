import { currentAccount, databaseNotConfigured, sameOrigin } from '../../lib/auth-db.js'
import { isOwner } from '../../lib/penny-owner.js'
import {
  importAllowedLegacyPenny, legacyImportStatus, verifyProductionBucketPrivate,
} from '../../lib/afterhours-legacy-import.js'

function requestBody(req) {
  if (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) return req.body
  if (typeof req.body !== 'string') return null
  try { return JSON.parse(req.body) } catch { return null }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'POST only.' })
  }
  if (!sameOrigin(req)) return res.status(403).json({ error: 'Origin check failed.' })
  try {
    const owner = await currentAccount(req)
    if (!owner) return res.status(401).json({ error: 'Messenger sign-in required.' })
    if (!isOwner(owner, process.env)) return res.status(403).json({ error: 'Owner only.' })
    const body = requestBody(req)
    if (!body || !['status', 'probe', 'import'].includes(body.action)) {
      return res.status(400).json({ error: 'Invalid import request.' })
    }
    if (body.action === 'status') {
      return res.status(200).json(await legacyImportStatus())
    }
    if (body.action === 'probe') {
      const privateBucket = await verifyProductionBucketPrivate()
      return res.status(privateBucket ? 200 : 409).json({ privateBucket })
    }
    const result = await importAllowedLegacyPenny(body.name, owner.id)
    if (!result) return res.status(400).json({ error: 'Unrecognized media filename.' })
    return res.status(200).json(result)
  } catch (error) {
    if (databaseNotConfigured(error) || error?.code === 'STORAGE_NOT_CONFIGURED') {
      return res.status(503).json({ error: 'Messenger storage unavailable.' })
    }
    if (error?.code === 'BUCKET_NOT_PRIVATE') {
      return res.status(409).json({ error: 'Private bucket verification failed. Import stopped.' })
    }
    console.error('Owner legacy media import failed', error)
    return res.status(503).json({ error: 'Private import failed verification. Existing files are unchanged.' })
  }
}
