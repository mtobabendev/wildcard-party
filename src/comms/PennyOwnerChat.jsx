import { useEffect, useState } from 'react'

const NAMES = { openai: 'OpenAI', gemini: 'Gemini', grok: 'Grok' }

export default function PennyOwnerChat() {
  const [providers, setProviders] = useState([])
  const [provider, setProvider] = useState('')
  const [question, setQuestion] = useState('')
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/penny-owner-chat', { credentials: 'same-origin', cache: 'no-store', signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error('Owner consultation unavailable.')
        const data = await response.json()
        if (!controller.signal.aborted) {
          setProviders(data.providers)
          setProvider(data.providers[0] || '')
        }
      })
      .catch(err => { if (!controller.signal.aborted) setError(err.message) })
    return () => controller.abort()
  }, [])

  async function send(event) {
    event.preventDefault()
    if (busy || !consent || !provider || !question.trim()) return
    setBusy(true)
    setError('')
    setResult(null)
    setConsent(false)
    try {
      const response = await fetch('/api/penny-owner-chat', {
        method: 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, question, shareProjectContext: true }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Owner consultation failed.')
      setResult(data)
    } catch (err) { setError(err.message) }
    finally { setBusy(false) }
  }

  return <section aria-label="Owner intelligence">
    <h2>♠ PROJECT CONSULTATION</h2>
    <p>Ask an enabled model about the six approved project records. The latest record contents and your question will be sent only to the selected provider. No personal notes, human messages or personal chat history are included. Answers are not saved to personal or project memory. Provider retention policies still apply.</p>
    <form onSubmit={send}>
      <label htmlFor="penny-owner-provider">Intelligence engine</label>
      <select id="penny-owner-provider" value={provider} disabled={busy || !providers.length} onChange={event => { setProvider(event.target.value); setConsent(false); setResult(null) }}>
        {!providers.length && <option value="">No engine configured</option>}
        {Object.entries(NAMES).map(([value, name]) => <option key={value} value={value} disabled={!providers.includes(value)}>{name}{providers.includes(value) ? '' : ' (not configured)'}</option>)}
      </select>
      <label htmlFor="penny-owner-question">Project question</label>
      <textarea id="penny-owner-question" rows="3" maxLength={2000} value={question} disabled={busy} onChange={event => { setQuestion(event.target.value); setConsent(false) }} />
      <label><input type="checkbox" checked={consent} disabled={busy || !provider} onChange={event => setConsent(event.target.checked)} /> Authorize sending the six latest approved records and this question to {NAMES[provider] || 'the selected provider'} for this request.</label>
      <button type="submit" disabled={busy || !consent || !provider || !question.trim()}>{busy ? 'Consulting Penny…' : 'Consult Penny'}</button>
    </form>
    {error && <p role="alert">{error}</p>}
    {result && <article><strong>Penny · {NAMES[result.provider]}</strong><p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{result.reply}</p></article>}
  </section>
}
