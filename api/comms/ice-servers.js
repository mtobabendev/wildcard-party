import { currentAccount } from '../../lib/auth-db.js'

const TWILIO_TOKEN_TTL_SECONDS = 3600
const TWILIO_FETCH_TIMEOUT_MS = 8000
const TWILIO_FETCH_ATTEMPTS = 2

function iceServerList(value) {
  if (!Array.isArray(value)) return []

  return value.flatMap((server) => {
    if (!server || typeof server !== 'object') return []

    const urls = typeof server.urls === 'string' || Array.isArray(server.urls)
      ? server.urls
      : null
    if (!urls) return []

    const result = { urls }
    if (typeof server.username === 'string' && server.username) {
      result.username = server.username
    }
    if (typeof server.credential === 'string' && server.credential) {
      result.credential = server.credential
    }

    return [result]
  })
}

async function fetchTwilioToken(url, options) {
  let lastFailure = null

  for (let attempt = 0; attempt < TWILIO_FETCH_ATTEMPTS; attempt += 1) {
    const controller = new AbortController()
    let timedOut = false
    const timeout = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, TWILIO_FETCH_TIMEOUT_MS)

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      })

      if (response.ok) {
        return { response, timedOut: false }
      }

      const retryable = response.status === 429 || response.status >= 500
      if (!retryable || attempt === TWILIO_FETCH_ATTEMPTS - 1) {
        return { response, timedOut: false }
      }

      lastFailure = { response, timedOut: false }
    } catch (error) {
      if (timedOut) {
        lastFailure = { response: null, timedOut: true }
      } else {
        lastFailure = { response: null, timedOut: false, error }
      }

      if (attempt === TWILIO_FETCH_ATTEMPTS - 1) {
        return lastFailure
      }
    } finally {
      clearTimeout(timeout)
    }
  }

  return lastFailure || { response: null, timedOut: false }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error: 'Method not allowed.' })
  }

  try {
    const account = await currentAccount(req)
    if (!account) {
      return res.status(401).json({ error: 'Sign in is required for COMMS calls.' })
    }

    const accountSid = process.env.TWILIO_ACCOUNT_SID
    const apiKey = process.env.TWILIO_API_KEY
    const apiSecret = process.env.TWILIO_API_SECRET

    if (!accountSid || !apiKey || !apiSecret) {
      console.error('COMMS ICE credential service is not configured.')
      return res.status(503).json({ error: 'ICE credential service is unavailable.' })
    }

    const authorization = Buffer
      .from(`${apiKey}:${apiSecret}`, 'utf8')
      .toString('base64')

    const twilioResult = await fetchTwilioToken(
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

    if (twilioResult.timedOut) {
      console.error('COMMS ICE credential request timed out.')
      return res.status(504).json({ error: 'ICE credential request timed out.' })
    }

    const response = twilioResult.response
    if (!response?.ok) {
      console.error('COMMS ICE credential request failed', {
        status: response?.status || null,
      })
      return res.status(502).json({ error: 'ICE credentials could not be obtained.' })
    }

    const token = await response.json()
    const iceServers = iceServerList(token?.ice_servers)

    if (!iceServers.length) {
      console.error('COMMS ICE credential response contained no ICE servers.')
      return res.status(502).json({ error: 'ICE credentials could not be obtained.' })
    }

    return res.status(200).json({ iceServers })
  } catch (error) {
    console.error('COMMS ICE credential endpoint failed', {
      name: error?.name || null,
    })
    return res.status(500).json({ error: 'ICE credential request failed.' })
  }
}
