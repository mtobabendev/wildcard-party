export function bodyOf(req) {
  if (req.body && typeof req.body === 'object') return req.body
  if (typeof req.body === 'string' && req.body.trim()) return JSON.parse(req.body)
  return {}
}

export function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for']
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim()
  }

  return req.socket?.remoteAddress || 'unknown'
}

export function textField(value, maxLength) {
  if (typeof value !== 'string') return ''

  const text = value.trim()
  if (!text || text.length > maxLength) return ''
  return text
}

export function createFixedWindowLimiter({
  windowMs,
  maxRequests,
  maxBuckets = 1000,
}) {
  const buckets = new Map()

  return function allowed(reqOrIp) {
    const key = typeof reqOrIp === 'string' ? reqOrIp : clientIp(reqOrIp)
    const now = Date.now()
    const floor = now - windowMs
    const recent = (buckets.get(key) || []).filter((stamp) => stamp > floor)

    if (recent.length >= maxRequests) {
      buckets.set(key, recent)
      return false
    }

    recent.push(now)
    buckets.set(key, recent)

    if (buckets.size > maxBuckets) {
      for (const [bucketKey, stamps] of buckets) {
        const live = stamps.filter((stamp) => stamp > floor)

        if (live.length) buckets.set(bucketKey, live)
        else buckets.delete(bucketKey)
      }
    }

    return true
  }
}
