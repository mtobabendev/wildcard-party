import {
  currentAccount, databaseNotConfigured, normalizeDisplayName,
  normalizeHandle, registerAccount, sameOrigin, validPassword,
} from '../../lib/auth-db.js'
import { isOwner } from '../../lib/penny-owner.js'
import { changeAreaGrant, listMemberAccess, recordAccessAudit, validAccountId, validArea } from '../../lib/afterhours-access.js'
import { resetMemberPassword } from '../../lib/afterhours-password.js'

function bodyOf(req) {
  if (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) return req.body
  if (typeof req.body === 'string' && req.body.trim()) {
    try { return JSON.parse(req.body) } catch { return null }
  }
  return null
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  if (!['GET', 'POST'].includes(req.method)) {
    res.setHeader('Allow', 'GET, POST')
    return res.status(405).json({ error: 'Method not allowed.' })
  }
  if (!sameOrigin(req)) return res.status(403).json({ error: 'Origin check failed.' })
  try {
    const operator = await currentAccount(req)
    if (!operator) return res.status(401).json({ error: 'Sign in required.' })
    if (!isOwner(operator, process.env)) {
      return res.status(403).json({ error: 'Owner only.' })
    }

    if (req.method === 'GET') {
      const members = await listMemberAccess(req.query?.q || '')
      return res.status(200).json({ members })
    }

    const body = bodyOf(req)
    if (!body) return res.status(400).json({ error: 'Invalid JSON body.' })

    if (body.action === 'create') {
      const handle = normalizeHandle(body.handle)
      const displayName = normalizeDisplayName(body.displayName)
      if (!handle || !displayName || !validPassword(body.password)) {
        return res.status(400).json({ error: 'Valid handle, display name, and password (10–128 chars) required.' })
      }
      const member = await registerAccount({ handle, displayName, password: body.password })
      await recordAccessAudit({ actorId: operator.id, accountId: member.id, action: 'create-account' })
      return res.status(201).json({ member })
    }

    const target = validAccountId(body.accountId)
    if (!target) return res.status(400).json({ error: 'Invalid member ID.' })

    if (body.action === 'grant' || body.action === 'revoke') {
      const area = validArea(body.area)
      if (!area) return res.status(400).json({ error: 'Invalid area.' })
      const changed = await changeAreaGrant({
        actorId: operator.id, accountId: target, area, grant: body.action === 'grant',
      })
      return changed
        ? res.status(200).json({ ok: true })
        : res.status(404).json({ error: 'Member not found.' })
    }

    if (body.action === 'reset-password') {
      if (target === operator.id.toLowerCase()) {
        return res.status(400).json({ error: 'Use the ordinary account recovery process for the Owner account.' })
      }
      if (!validPassword(body.password)) {
        return res.status(400).json({ error: 'Password must be 10–128 characters.' })
      }
      const changed = await resetMemberPassword(target, body.password)
      if (!changed) return res.status(404).json({ error: 'Member not found.' })
      await recordAccessAudit({ actorId: operator.id, accountId: target, action: 'reset-password' })
      return res.status(200).json({ ok: true, sessionsRevoked: true })
    }

    return res.status(400).json({ error: 'Unknown action.' })
  } catch (error) {
    if (databaseNotConfigured(error)) return res.status(503).json({ error: 'Membership database unavailable.' })
    if (error?.code === 'HANDLE_TAKEN') return res.status(409).json({ error: 'Handle already taken.' })
    console.error('after hours owner admin failed', error)
    return res.status(503).json({ error: 'Owner operation could not be completed.' })
  }
}
