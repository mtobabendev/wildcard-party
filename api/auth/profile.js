import {
  claimAnonymousContent,
  currentAccount,
  databaseNotConfigured,
  normalizeBio,
  normalizeDisplayName,
  normalizeHandle,
  sameOrigin,
  updateAccountProfile,
} from '../../lib/auth-db.js'
import { bodyOf } from '../../lib/http.js'

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')

  if (req.method !== 'PATCH') {
    res.setHeader('Allow', 'PATCH')
    return res.status(405).json({ error: 'PATCH only.' })
  }

  if (!sameOrigin(req)) {
    return res.status(403).json({ error: 'Origin check failed.' })
  }

  try {
    const account = await currentAccount(req)
    if (!account) return res.status(401).json({ error: 'Sign in required.' })

    const body = bodyOf(req)
    const handle = normalizeHandle(body.handle)
    const displayName = normalizeDisplayName(body.displayName)
    const bio = normalizeBio(body.bio)

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

    if (bio === null) {
      return res.status(400).json({ error: 'Bio must be 280 characters or fewer.' })
    }

    const updated = await updateAccountProfile(account.id, { handle, displayName, bio })
    await claimAnonymousContent(updated, body.ownerToken || '')

    return res.status(200).json({ account: updated })
  } catch (error) {
    if (databaseNotConfigured(error)) {
      return res.status(503).json({ error: 'Accounts are staged but the database is not connected.' })
    }

    if (error?.code === 'HANDLE_TAKEN') {
      return res.status(409).json({ error: 'That handle is already taken.' })
    }

    console.error('profile error', error)
    return res.status(500).json({ error: 'Profile update failed.' })
  }
}
