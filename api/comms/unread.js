import {
  currentAccount,
  databaseNotConfigured,
} from '../../lib/auth-db.js'
import { totalUnreadCount } from '../../lib/comms-db.js'

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')

  try {
    const account = await currentAccount(req)
    if (!account) {
      return res.status(401).json({ error: 'Sign in is required for COMMS.' })
    }

    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET')
      return res.status(405).json({ error: 'Method not allowed.' })
    }

    const unreadCount = await totalUnreadCount(account.id)
    return res.status(200).json({ unreadCount })
  } catch (error) {
    if (databaseNotConfigured(error)) {
      return res.status(503).json({ error: 'COMMS persistence is not connected yet.' })
    }

    console.error('comms unread api error', error)
    return res.status(500).json({ error: 'Unread state could not be loaded.' })
  }
}
