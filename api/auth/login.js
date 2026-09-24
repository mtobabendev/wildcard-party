import {
  authenticateAccount,
  claimAnonymousContent,
  createSession,
  databaseNotConfigured,
  normalizeHandle,
  sameOrigin,
  validPassword,
} from '../../lib/auth-db.js'
import { bodyOf, createFixedWindowLimiter } from '../../lib/http.js'

const allow = createFixedWindowLimiter({
  windowMs: 10 * 60 * 1000,
  maxRequests: 12,
})

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'POST only.' })
  }

  if (!sameOrigin(req)) {
    return res.status(403).json({ error: 'Origin check failed.' })
  }

  if (!allow(req)) {
    return res.status(429).json({ error: 'Too many sign-in attempts. Try again shortly.' })
  }

  try {
    const body = bodyOf(req)
    const handle = normalizeHandle(body.handle)
    const password = body.password

    if (!handle || !validPassword(password)) {
      return res.status(401).json({ error: 'Handle or password is incorrect.' })
    }

    const account = await authenticateAccount({ handle, password })

    if (!account) {
      return res.status(401).json({ error: 'Handle or password is incorrect.' })
    }

    const claimed = await claimAnonymousContent(account, body.ownerToken || '')
    await createSession(res, account.id)

    return res.status(200).json({ account, claimed })
  } catch (error) {
    if (databaseNotConfigured(error)) {
      return res.status(503).json({ error: 'Accounts are staged but the database is not connected.' })
    }

    console.error('login error', error)
    return res.status(500).json({ error: 'Sign in failed.' })
  }
}
