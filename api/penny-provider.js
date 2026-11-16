import handler from './penny.js'

export default async function providerHandler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'POST only.' })
  }
  let body
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body } catch { return res.status(400).json({ error: 'Invalid request.' }) }
  if (body?.provider !== 'gemini') return res.status(400).json({ error: 'Gemini provider required.' })
  return handler(req, res)
}
