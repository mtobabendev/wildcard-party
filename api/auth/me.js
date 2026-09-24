import {
  currentAccount,
  databaseNotConfigured,
} from '../../lib/auth-db.js'

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error: 'GET only.' })
  }

  try {
    const account = await currentAccount(req)
    return res.status(200).json({ account })
  } catch (error) {
    if (databaseNotConfigured(error)) {
      return res.status(503).json({ error: 'Accounts are staged but the database is not connected.' })
    }

    console.error('me error', error)
    return res.status(500).json({ error: 'Account session lookup failed.' })
  }
}
