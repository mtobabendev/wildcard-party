import { currentAccount, databaseNotConfigured, sameOrigin } from '../../lib/auth-db.js'
import { isOwner } from '../../lib/penny-owner.js'
import { validArea } from '../../lib/afterhours-access.js'
import { finishPrivateUpload, startPrivateUpload, validMediaSize, validMediaType } from '../../lib/afterhours-media.js'

function bodyOf(req) {
  if (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) return req.body
  if (typeof req.body !== 'string' || !req.body.trim()) return null
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
    const account = await currentAccount(req)
    if (!account) return res.status(401).json({ error: 'Login required.' })
    if (!isOwner(account, process.env)) return res.status(403).json({ error: 'Owner only.' })
    const body = bodyOf(req)
    if (!body) return res.status(400).json({ error: 'Invalid JSON.' })
    if (body.action === 'start') {
      const area = validArea(body.area)
      const contentType = validMediaType(body.contentType)
      if (!area || !contentType || !validMediaSize(body.byteSize) ||
          typeof body.name !== 'string' || !body.name.trim() || body.name.length > 180) {
        return res.status(400).json({ error: 'Invalid media metadata.' })
      }
      const upload = await startPrivateUpload({
        ownerId: account.id, area, name: body.name,
        type: contentType, size: body.byteSize,
      })
      return res.status(201).json({ upload })
    }
    if (body.action === 'finish') {
      const done = await finishPrivateUpload(account.id, body.id)
      return done
        ? res.status(200).json({ ok: true })
        : res.status(409).json({ error: 'Upload not found or not verified.' })
    }
    return res.status(400).json({ error: 'Unknown media action.' })
  } catch (error) {
    if (databaseNotConfigured(error) || error?.code === 'STORAGE_NOT_CONFIGURED') {
      return res.status(503).json({ error: 'Private media storage unavailable.' })
    }
    console.error('after hours private upload failed', error)
    return res.status(503).json({ error: 'Private media operation failed.' })
  }
}
