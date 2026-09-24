import {
  claimAnonymousContent,
  createSession,
  databaseNotConfigured,
  normalizeDisplayName,
  normalizeHandle,
  registerAccount,
  sameOrigin,
  validPassword,
} from '../../lib/auth-db.js'
import { bodyOf, createFixedWindowLimiter } from '../../lib/http.js'

const allow = createFixedWindowLimiter({
  windowMs: 10 * 60 * 1000,
  maxRequests: 8,
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
    return res.status(429).json({ error: 'Too many account attempts. Try again shortly.' })
  }

  try {
    const body = bodyOf(req)
    const handle = normalizeHandle(body.handle)
    const displayName = normalizeDisplayName(body.displayName)
    const password = body.password

    if (!handle) {
      return res.status(400).json({
        error: 'Handle must be 3–24 characters using letters, numbers, or underscores.',
      })
    }

    if (!displayName) {
      return res.status(400).json({
        error: 'Display name must be 2–60 characters.',
      })
    }

    if (!validPassword(password)) {
      return res.status(400).json({
        error: 'Password must be between 10 and 128 characters.',
      })
    }

    const account = await registerAccount({ handle, displayName, password })
    const claimed = await claimAnonymousContent(account, body.ownerToken || '')
    await createSession(res, account.id)

    return res.status(201).json({ account, claimed })
  } catch (error) {
    if (databaseNotConfigured(error)) {
      return res.status(503).json({ error: 'Accounts are staged but the database is not connected.' })
    }

    if (error?.code === 'HANDLE_TAKEN') {
      return res.status(409).json({ error: 'That handle is already taken.' })
    }

    console.error('register error', error)
    return res.status(500).json({ error: 'Account creation failed.' })
  }
}
