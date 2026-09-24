import {
  authenticateAccount,
  claimAnonymousContent,
  createSession,
  databaseNotConfigured,
  normalizeHandle,
  sameOrigin,
  validPassword,
} from '../../lib/auth-db.js'

const WINDOW_MS = 10 * 60 * 1000
const MAX_ATTEMPTS = 12
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
