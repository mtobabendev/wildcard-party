import { currentAccount, databaseNotConfigured } from '../../lib/auth-db.js'
import { isOwner } from '../../lib/penny-owner.js'
import { hasAreaGrant, validAccountId, validArea } from '../../lib/afterhours-access.js'
import { listPrivateMedia, privateMediaDownload, privateMediaByName, signedPrivateMediaUrl } from '../../lib/afterhours-media.js'

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'no-referrer')
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error: 'GET only.' })
  }
  const mediaId = req.query?.id
  const name = req.query?.name
  const area = validArea(req.query?.area)
  if ((mediaId != null && (name != null || !validAccountId(mediaId))) ||
      (name != null && (!area || typeof name !== 'string' || name.length < 1 || name.length > 180)) ||
      (mediaId == null && !area)) {
    return res.status(400).json({ error: 'Invalid media request.' })
  }

  try {
    const account = await currentAccount(req)
    if (!account) return res.status(401).json({ error: 'Messenger login required.' })

    if (mediaId) {
      const item = await privateMediaDownload(mediaId)
      if (!item) return res.status(404).json({ error: 'Media not found.' })
      const allowed = isOwner(account, process.env) || await hasAreaGrant(account.id, item.area)
      if (!allowed) return res.status(404).json({ error: 'Media not found.' })
      res.statusCode = 302
      res.setHeader('Location', await signedPrivateMediaUrl(item))
      return res.end()
    }

    const allowed = isOwner(account, process.env) || await hasAreaGrant(account.id, area)
    if (!allowed) return res.status(403).json({ error: 'Owner approval required.' })
    if (name != null) {
      const item = await privateMediaByName(area, name)
      if (!item) return res.status(404).json({ error: 'Media not found.' })
      res.statusCode = 302
      res.setHeader('Location', await signedPrivateMediaUrl(item))
      return res.end()
    }
    return res.status(200).json({ area, media: await listPrivateMedia(area) })
  } catch (error) {
    if (databaseNotConfigured(error) || error?.code === 'STORAGE_NOT_CONFIGURED') {
      return res.status(503).json({ error: 'Private media service unavailable.' })
    }
    console.error('after hours media access failed', error)
    return res.status(503).json({ error: 'Private media service unavailable.' })
  }
}
