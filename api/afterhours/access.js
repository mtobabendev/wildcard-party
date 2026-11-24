import { currentAccount, databaseNotConfigured } from '../../lib/auth-db.js'
import { hasAreaGrant, validArea } from '../../lib/afterhours-access.js'
import { isOwner } from '../../lib/penny-owner.js'

// Dependency injection exists only to test every authorization decision with
// synthetic identities, without touching the Owner's live database.
export function createAccessHandler({
  getAccount = currentAccount,
  hasGrant = hasAreaGrant,
  ownerCheck = isOwner,
  env = process.env,
} = {}) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'private, no-store')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET')
      return res.status(405).json({ error: 'GET only.' })
    }
    const area = validArea(req.query?.area)
    if (!area) return res.status(400).json({ error: 'Invalid area.' })
    try {
      const account = await getAccount(req)
      if (!account) return res.status(401).json({ allowed: false, reason: 'login' })
      const allowed = ownerCheck(account, env) || await hasGrant(account.id, area)
      if (!allowed) return res.status(403).json({ allowed: false, reason: 'not-approved' })
      return res.status(200).json({ allowed: true, area, handle: account.handle, owner: ownerCheck(account, env) })
    } catch (error) {
      if (databaseNotConfigured(error)) {
        return res.status(503).json({ error: 'Membership database unavailable.' })
      }
      console.error('after hours access failed', error)
      return res.status(503).json({ error: 'Access could not be verified.' })
    }
  }
}

export default createAccessHandler()
