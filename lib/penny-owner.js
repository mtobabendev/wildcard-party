const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const PRODUCTION_SOURCE = 'https://www.wildcarddev.com/api/pennycore'
const APPROVED_RECORDS = Object.freeze([
  ['memory', 'wildcarddev/project'],
  ['governance', 'engineering/occam'],
  ['governance', 'engineering/owner-gate'],
  ['governance', 'pennycore/data-boundaries'],
  ['context', 'pennycore/architecture'],
  ['state', 'pennycore/rollout'],
])

export function isOwner(account, env) {
  const configured = env.PENNYCORE_OWNER_ACCOUNT_ID
  return typeof configured === 'string' && UUID.test(configured) &&
    typeof account?.id === 'string' && UUID.test(account.id) &&
    account.id.toLowerCase() === configured.toLowerCase()
}

export function configuredForRead(env) {
  return env.VERCEL_ENV === 'production' &&
    typeof env.PENNYCORE_READ_TOKEN === 'string' &&
    env.PENNYCORE_READ_TOKEN.length >= 32
}

async function readApprovedRecords(env, fetcher) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10000)
  try {
    return await Promise.all(APPROVED_RECORDS.map(async ([kind, key]) => {
      const url = new URL(PRODUCTION_SOURCE)
      url.search = new URLSearchParams({ kind, key, latest: '1' }).toString()
      const response = await fetcher(url.toString(), {
        method: 'GET',
        headers: { Authorization: 'Bearer ' + env.PENNYCORE_READ_TOKEN, Accept: 'application/json' },
        cache: 'no-store',
        redirect: 'error',
        signal: controller.signal,
      })
      if (!response.ok) throw new Error('Owner memory unavailable.')
      const data = await response.json()
      if (!Array.isArray(data.records) || data.records.length > 1) throw new Error('Invalid response.')
      if (data.records.length === 0) return { kind, key, available: false }
      const record = data.records[0]
      if (record?.kind !== kind || record.key !== key ||
          !record.payload || typeof record.payload !== 'object' || Array.isArray(record.payload) ||
          typeof record.createdAt !== 'string' || JSON.stringify(record.payload).length > 16384) {
        throw new Error('Unexpected record.')
      }
      return { kind, key, available: true, payload: record.payload, createdAt: record.createdAt }
    }))
  } finally {
    controller.abort()
    clearTimeout(timer)
  }
}

export function createOwnerHandler({ currentAccount, sameOrigin, env = process.env, fetcher = globalThis.fetch }) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'private, no-store')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET')
      return res.status(405).json({ error: 'GET only.' })
    }
    if (!sameOrigin(req)) return res.status(403).json({ error: 'Origin check failed.' })
    try {
      const account = await currentAccount(req)
      if (!account) return res.status(401).json({ error: 'Sign in required.' })
      if (!isOwner(account, env)) return res.status(403).json({ error: 'Owner authorization required.' })
      const query = req.query || {}
      if (Object.keys(query).some(key => key !== 'view') ||
          !['status', 'records'].includes(query.view)) {
        return res.status(400).json({ error: 'Invalid owner view.' })
      }
      const ready = configuredForRead(env)
      if (query.view === 'status') return res.status(200).json({ owner: true, ready })
      if (!ready) return res.status(503).json({ error: 'Owner project memory is not enabled for this environment.' })
      const records = await readApprovedRecords(env, fetcher)
      return res.status(200).json({ records })
    } catch {
      return res.status(503).json({ error: 'Owner project memory is unavailable.' })
    }
  }
}

export async function readOwnerContext(account, env = process.env, fetcher = globalThis.fetch) {
  if (!isOwner(account, env) || !configuredForRead(env)) throw new Error('Owner project memory unavailable.')
  const records = await readApprovedRecords(env, fetcher)
  if (records.some(record => !record.available)) throw new Error('Approved project memory incomplete.')
  return records
}
