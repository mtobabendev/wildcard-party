import { appendTurn, parseAction } from './penny-core-state.js'

export function createPennyCoreHandler({ currentAccount, sameOrigin, readState, saveState, askModel, rateAllowed, clientIp }) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'private, no-store')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    if (!['GET', 'POST'].includes(req.method)) {
      res.setHeader('Allow', 'GET, POST')
      return res.status(405).json({ error: 'Method not allowed.' })
    }
    if (!sameOrigin(req)) return res.status(403).json({ error: 'Origin check failed.' })
    try {
      const account = await currentAccount(req)
      if (!account) return res.status(401).json({ error: 'Sign in to access Penny Core.' })
      if (req.method === 'GET') return res.status(200).json(await readState(account.id))
      let action
      try {
        action = parseAction(typeof req.body === 'string' ? JSON.parse(req.body) : req.body)
      } catch (error) {
        return res.status(400).json({ error: error.message || 'Invalid request.' })
      }
      const state = await readState(account.id)
      if (state.revision !== action.revision) return res.status(409).json({ error: 'State changed. Reload before retrying.' })
      let next = { ...state }
      if (action.action === 'save-notes') next.notes = action.notes
      if (action.action === 'clear-history') next.history = []
      if (action.action === 'chat') {
        if (!rateAllowed(clientIp(req))) return res.status(429).json({ error: 'Too many requests. Try again shortly.' })
        let reply
        try { reply = await askModel(state, action.message) }
        catch { return res.status(502).json({ error: 'Penny could not complete the reply. Nothing was saved.' }) }
        next.history = appendTurn(state.history, action.message, reply)
      }
      const saved = await saveState(account.id, state.revision, next)
      if (!saved) return res.status(409).json({ error: 'State changed on another device. Reload before retrying.' })
      return res.status(200).json(saved)
    } catch {
      return res.status(500).json({ error: 'Penny Core could not access private state.' })
    }
  }
}
