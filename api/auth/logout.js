import {
  databaseNotConfigured,
  deleteCurrentSession,
  sameOrigin,
} from '../../lib/auth-db.js'

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'POST only.' })
  }

  if (!sameOrigin(req)) {
    return res.status(403).json({ error: 'Origin check failed.' })
  }

  try {
    await deleteCurrentSession(req, res)
    return res.status(200).json({ signedOut: true })
  } catch (error) {
    if (databaseNotConfigured(error)) {
      return res.status(503).json({ error: 'Accounts are staged but the database is not connected.' })
    }

    console.error('logout error', error)
    return res.status(500).json({ error: 'Sign out failed.' })
  }
}
