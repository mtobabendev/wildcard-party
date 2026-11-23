import { currentAccount, databaseNotConfigured, sameOrigin } from '../../lib/auth-db.js'
import { isOwner } from '../../lib/penny-owner.js'
import { validArea } from '../../lib/afterhours-access.js'
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
    if (body.action === 'start') {
      const area = validArea(body.area)
      const contentType = validMediaType(body.contentType)
      if (!area || !contentType || !validMediaSize(body.byteSize) ||
          !validName(body.name)) {
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
