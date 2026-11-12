import { useEffect, useState } from 'react'
import './penny-core.css'

async function request(options = {}) {
  const response = await fetch('/api/penny-core', { ...options, credentials: 'same-origin', cache: 'no-store' })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || 'Penny Core request failed.')
  return data
}

export default function PennyCore() {
  const [state, setState] = useState(null)
  const [notes, setNotes] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [refresh, setRefresh] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setState(null)
    setError('')
    setStatus('')
    request({ signal: controller.signal })
      .then(data => { if (!controller.signal.aborted) { setState(data); setNotes(data.notes) } })
      .catch(err => { if (!controller.signal.aborted) setError(err.message) })
    return () => controller.abort()
  }, [refresh])

  async function submit(action, extra = {}) {
    if (!state || busy) return
    setBusy(true)
    setError('')
    setStatus('')
    try {
      const data = await request({ method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, revision: state.revision, ...extra }) })
      setState(data)
      if (action === 'save-notes') setNotes(data.notes)
      if (action === 'chat') setMessage('')
      setStatus(action === 'save-notes' ? 'Memory saved.' : action === 'clear-history' ? 'History cleared.' : 'Conversation saved.')
    } catch (err) { setError(err.message) }
    finally { setBusy(false) }
  }

  return (
    <section className="penny-core panel">
      <header><h1>♠ PENNY CORE</h1><p>Private AI continuity · WildCard DEV</p></header>
      <p>Only your signed-in account can access this state through the app. Saved notes and recent conversation are sent to the AI service when you chat. Do not store passwords, keys or sensitive records here.</p>
      <button type="button" disabled={busy} onClick={() => {
        if (state && notes !== state.notes && !window.confirm('Discard unsaved notes?')) return
        setRefresh(value => value + 1)
      }}>Reload from server</button>
      {error && <p role="alert" className="messenger-error">{error}</p>}
      {status && <p role="status">{status}</p>}
      {!state ? <p>{error ? 'Private state could not load.' : 'Loading private state…'}</p> : <>
        <form onSubmit={event => { event.preventDefault(); submit('save-notes', { notes }) }}>
          <label htmlFor="penny-core-notes">Memory notes (editable, explicitly saved)</label>
          <textarea id="penny-core-notes" rows="5" maxLength={6000} value={notes} disabled={busy} onChange={event => setNotes(event.target.value)} />
          <button type="submit" disabled={busy || notes === state.notes}>Save memory</button>
        </form>
        <div className="penny-core-history" role="log" aria-label="Saved conversation" aria-live="polite">
          {state.history.length ? state.history.map((item, index) => <article key={index}><strong>{item.role === 'assistant' ? 'Penny' : 'You'}</strong><p>{item.content}</p></article>) : <p>No private conversation yet.</p>}
        </div>
        <form onSubmit={event => { event.preventDefault(); submit('chat', { message }) }}>
          <label htmlFor="penny-core-message">Message Penny (saved to your account)</label>
          <textarea id="penny-core-message" rows="3" maxLength={2000} value={message} disabled={busy} onChange={event => setMessage(event.target.value)} />
          <button type="submit" disabled={busy || !message.trim()}>{busy ? 'Working…' : 'Send to Penny'}</button>
        </form>
        <p>Last 40 messages retained. Clear history removes the saved conversation, not memory notes or human COMMS.</p>
        <button type="button" disabled={busy || !state.history.length} onClick={() => {
          if (window.confirm('Clear your saved Penny Core conversation?')) submit('clear-history')
        }}>Clear conversation</button>
      </>}
    </section>
  )
}
