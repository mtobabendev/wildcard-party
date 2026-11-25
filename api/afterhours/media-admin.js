import { currentAccount, databaseNotConfigured, sameOrigin } from '../../lib/auth-db.js'
import { isOwner } from '../../lib/penny-owner.js'
import { validArea, validAccountId } from '../../lib/afterhours-access.js'
import { validCollectionLabel } from '../../src/afterhours/mediaCollections.js'
import { uploadLimit } from '../../lib/media-storage-routing.js'
import { decodeRelayBytes } from '../../lib/afterhours-upload-bytes.js'
import { finishPrivateUpload, startPrivateUpload, privateMediaByName, validMediaSize, validMediaType } from '../../lib/afterhours-media.js'
import { issueUploadToken, ownerFromUploadToken, revokeOwnerUploadTokens } from '../../lib/afterhours-agent-token.js'

function bodyOf(req) {
  if (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) return req.body
  if (typeof req.body !== 'string' || !req.body.trim()) return null
  try { return JSON.parse(req.body) } catch { return null }
}

function validName(name) {
  return typeof name === 'string' && name.length > 0 && name.length <= 180
    && !name.includes('/') && !name.includes('\\')
    && !/[\u0000-\u001f\u007f]/.test(name)
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'POST only.' })
  }
  // A browser cannot call cross-origin. The paired local uploader sends
  // Authorization and no Origin; no login cookies or storage secrets leak.
  if (!sameOrigin(req)) return res.status(403).json({ error: 'Origin check failed.' })
  try {
    const browserAccount = await currentAccount(req)
    const ownerBrowser = isOwner(browserAccount, process.env)
    const pairedAccount = ownerBrowser ? null : await ownerFromUploadToken(req)
    if (!ownerBrowser && !pairedAccount) {
      return res.status(browserAccount ? 403 : 401).json({
        error: browserAccount ? 'Owner only.' : 'Login or workstation pairing required.'
      })
    }
    const body = bodyOf(req)
    if (!body || typeof body.action !== 'string') {
      return res.status(400).json({ error: 'Invalid JSON.' })
    }

    // Pairing and revocation always require the existing browser Owner
    // login. Scoped bearer credentials can NEVER mint more credentials.
    if (body.action === 'pair' || body.action === 'revoke-pairings') {
      if (!browserAccount) return res.status(401).json({ error: 'Login required.' })
      if (!ownerBrowser) return res.status(403).json({ error: 'Owner only.' })
      if (!req.headers.origin) return res.status(403).json({ error: 'Owner browser origin required.' })
      if (body.action === 'pair') {
        const pairing = await issueUploadToken(browserAccount.id)
        return res.status(201).json({ pairing })
      }
      const revoked = await revokeOwnerUploadTokens(browserAccount.id)
      return res.status(200).json({ revoked })
    }

    // Existing Owner UI still uses its cookie. Automated local uploads
    // use a narrowly scoped 90-day credential valid ONLY in this API.
    const account = ownerBrowser ? browserAccount : pairedAccount
    if (!isOwner(account, process.env)) return res.status(403).json({ error: 'Owner only.' })

    // Gallery moves require the Owner browser, never a workstation upload token.
    if (body.action === 'move') {
      if (!ownerBrowser || !req.headers.origin) return res.status(403).json({ error: 'Owner browser required.' })
      const area = validArea(body.area)
      if (!area || !validAccountId(body.id) || !validName(body.name) || !validCollectionLabel(body.collection)) {
        return res.status(400).json({ error: 'Invalid media or gallery name.' })
      }
      const { movePrivateMedia } = await import('../../lib/afterhours-media.js')
      const moved = await movePrivateMedia({ area, id: body.id, name: body.name, collection: body.collection })
      return moved ? res.status(200).json({ ok: true, collection: body.collection }) : res.status(404).json({ error: 'Media not found.' })
    }

    // Removal is restricted to an authenticated Owner browser, not upload tokens.
    if (body.action === 'remove') {
      if (!ownerBrowser || !req.headers.origin) return res.status(403).json({ error: 'Owner browser required.' })
      const area = validArea(body.area)
      if (!area || !validName(body.name) || typeof body.id !== 'string' ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.id)) {
        return res.status(400).json({ error: 'Invalid removal target.' })
      }
      const { removePrivateMedia } = await import('../../lib/afterhours-media.js')
      const removed = await removePrivateMedia({ area, id: body.id, name: body.name })
      return removed ? res.status(200).json({ ok: true }) : res.status(404).json({ error: 'Media not found.' })
    }

    if (body.action === 'check') {
      const area = validArea(body.area)
      if (!area || (body.name != null && !validName(body.name))) {
        return res.status(400).json({ error: 'Invalid media metadata.' })
      }
      const existing = body.name ? await privateMediaByName(area, body.name) : null
      return res.status(200).json({
        ok: true, area, exists: Boolean(existing), type: existing?.content_type || null
      })
    }
    if (body.action === 'relay') {
      if (!ownerBrowser || !req.headers.origin) return res.status(403).json({ error: 'Owner browser required.' })
      const area = validArea(body.area)
      const contentType = validMediaType(body.contentType)
      const bytes = decodeRelayBytes(body.base64, body.byteSize)
      if (!area || !contentType || !validName(body.name) || !bytes) {
        return res.status(400).json({ error: 'Invalid small-file upload.' })
      }
      const { relayPrivateUpload } = await import('../../lib/afterhours-media.js')
      const done = await relayPrivateUpload({ ownerId: account.id, area, name: body.name, type: contentType, bytes })
      return done ? res.status(200).json({ ok: true }) : res.status(409).json({ error: 'Upload not verified.' })
    }
    if (body.action === 'start') {
      const area = validArea(body.area)
      const contentType = validMediaType(body.contentType)
      if (!area || !contentType || !validMediaSize(body.byteSize) ||
          !validName(body.name)) {
        return res.status(400).json({ error: 'Invalid media metadata or file exceeds the configured '+Math.floor(uploadLimit()/1000000)+' MB limit.' })
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
