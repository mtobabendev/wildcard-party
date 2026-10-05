import {
  currentAccount,
  databaseNotConfigured,
  sameOrigin,
} from '../../lib/auth-db.js'

const TWILIO_TOKEN_TTL_SECONDS = 3600

function normalizeIceServer(server) {
  const urls = Array.isArray(server?.urls)
    ? server.urls.filter((url) => typeof url === 'string' && url)
    : typeof server?.urls === 'string' && server.urls
      ? [server.urls]
      : []

  if (!urls.length) return null

  const normalized = {
    urls: Array.isArray(server.urls) ? urls : urls[0],
  }

  if (typeof server.username === 'string' && server.username) {
    normalized.username = server.username
  }

  if (typeof server.credential === 'string' && server.credential) {
    normalized.credential = server.credential
  }

  return normalized
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')

  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST')
      return res.status(405).json({ error: 'Method not allowed.' })
    }

    if (!sameOrigin(req)) {
      return res.status(403).json({ error: 'Origin check failed.' })
    }

    const account = await currentAccount(req)
    if (!account) {
      return res.status(401).json({ error: 'Sign in is required for COMMS.' })
    }

    const accountSid = process.env.TWILIO_ACCOUNT_SID
    const apiKey = process.env.TWILIO_API_KEY
    const apiSecret = process.env.TWILIO_API_SECRET
    if (!accountSid || !apiKey || !apiSecret) {
      return res.status(503).json({ error: 'Audio traversal is not configured.' })
    }

    const authorization = Buffer.from(`${apiKey}:${apiSecret}`).toString('base64')
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Tokens.json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${authorization}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          Ttl: String(TWILIO_TOKEN_TTL_SECONDS),
        }),
      },
    )

    const payload = await response.json().catch(() => null)
    if (!response.ok) {
      console.error('twilio nts token request failed', {
        status: response.status,
        code: payload?.code,
        message: payload?.message,
      })
      return res.status(502).json({ error: 'Audio traversal is unavailable.' })
    }

    const iceServers = Array.isArray(payload?.ice_servers)
      ? payload.ice_servers.map(normalizeIceServer).filter(Boolean)
      : []

    if (!iceServers.length) {
      console.error('twilio nts token response missing ice servers')
      return res.status(502).json({ error: 'Audio traversal is unavailable.' })
    }

    return res.status(200).json({ iceServers })
  } catch (error) {
    if (databaseNotConfigured(error)) {
      return res.status(503).json({ error: 'COMMS persistence is not connected yet.' })
    }

    console.error('comms ice servers api error', error)
    return res.status(500).json({ error: 'Audio traversal request failed.' })
  }
}
