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

const WINDOW_MS = 10 * 60 * 1000
const MAX_ATTEMPTS = 8
const buckets = new Map()

function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for']
  if (typeof forwarded === 'string' && forwarded.trim()) return forwarded.split(',')[0].trim()
  return req.socket?.remoteAddress || 'unknown'
}

function allow(ip) {
  const now = Date.now()
  const floor = now - WINDOW_MS
  const recent = (buckets.get(ip) || []).filter((stamp) => stamp > floor)
  if (recent.length >= MAX_ATTEMPTS) {
    buckets.set(ip, recent)
    return false
  }
  recent.push(now)
  buckets.set(ip, recent)
  return true
}

function bodyOf(req) {
  if (req.body && typeof req.body === 'object') return req.body
  if (typeof req.body === 'string' && req.body.trim()) return JSON.parse(req.body)
  return {}
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'POST only.' })
  }

  if (!sameOrigin(req)) {
    return res.status(403).json({ error: 'Origin check failed.' })
  }

  if (!allow(clientIp(req))) {
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
