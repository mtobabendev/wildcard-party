import {
  currentAccount,
  databaseNotConfigured,
} from '../../lib/auth-db.js'
import { searchAccounts } from '../../lib/comms-db.js'

function queryValue(value) {
  return typeof value === 'string' ? value : ''
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error: 'GET only.' })
  }

  try {
    const account = await currentAccount(req)
    if (!account) {
      return res.status(401).json({ error: 'Sign in is required for COMMS.' })
    }

    const query = queryValue(req.query?.q).trim()
    if (query.length < 2 || query.length > 60) {
      return res.status(400).json({ error: 'Enter at least 2 characters to search accounts.' })
    }

    const accounts = await searchAccounts(account.id, query)
    return res.status(200).json({ accounts })
  } catch (error) {
    if (databaseNotConfigured(error)) {
      return res.status(503).json({ error: 'COMMS persistence is not connected yet.' })
    }

    console.error('comms accounts api error', error)
    return res.status(500).json({ error: 'Account discovery failed.' })
  }
}
