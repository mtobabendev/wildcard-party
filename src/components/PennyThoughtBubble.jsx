import { useEffect, useId, useRef, useState } from 'react'
import './PennyThoughtBubble.css'
import PennyActiveAvatar from './PennyActiveAvatar.jsx'
import { usePennyAwareness } from './penny-awareness-client.js'
import { CITIES, SIGNS } from './penny-awareness-data.js'

const AWARENESS_ENDPOINT = 'https://www.wildcarddev.com/api/penny-awareness'

const greetings = [
  ['Good morning', 'Coffee first, world domination second.', 'Coffee, darling?'],
  ['Good afternoon', 'What are we building today?', 'The afternoon looks promising.'],
  ['Good evening', 'Let’s make something remarkable.', 'The evening is just getting interesting.'],
  ['You’re up late', 'The workshop never sleeps.', 'The night has excellent company.'],
]
const quips = [
  ['One brilliant idea at a time.', 'A little magic, a lot of engineering.'],
  ['The best solutions have fewer moving parts.', 'Let’s put that imagination to work.'],
  ['Neon lights and bright ideas.', 'The next great idea might be yours.'],
  ['Even the moon has a night shift.', 'Quiet hours, loud ideas.'],
]
function getPeriod(hour) {
  return hour >= 5 && hour < 12 ? 0 : hour >= 12 && hour < 17 ? 1 : hour >= 17 && hour < 22 ? 2 : 3
}
export default function PennyThoughtBubble({ provider = 'gemini', placement = 'main' }) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [pageHidden, setPageHidden] = useState(() => document.hidden)
  const [clock, setClock] = useState(() => new Date())
  const [quipIndex, setQuipIndex] = useState(0)
  const [draft, setDraft] = useState('')
  const [messages, setMessages] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const request = useRef(null)
  const dialog = useRef(null)
  const trigger = useRef(null)
  const titleId = useId()
  const period = getPeriod(clock.getHours())
  const afterHours = placement === 'after-hours'
  const name = provider === 'grok' ? 'Grok' : 'Gemini'
  const greeting = greetings[period][0]
  const quip = quipIndex % 3 === 0 ? greetings[period][afterHours ? 2 : 1] : quips[period][(quipIndex - 1) % 2]
  const awareness = usePennyAwareness(AWARENESS_ENDPOINT, clock)
  const thought = awareness.alerts[0] || (quipIndex % 2 === 1 ? awareness.cards[Math.floor(quipIndex / 2) % awareness.cards.length] : null)
  const heading = thought?.label || greeting
  const line = thought?.text || quip
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!document.hidden) { setClock(new Date()); if (!dialog.current?.open) setQuipIndex(value => value + 1) }
    }, 60000)
    const onVisible = () => {
      setPageHidden(document.hidden)
      if (!document.hidden) setClock(new Date())
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisible) }
  }, [])
  useEffect(() => () => request.current?.abort(), [])
  function close() {
    setDialogOpen(false)
    request.current?.abort()
    trigger.current?.focus()
  }
  async function send(event) {
    event.preventDefault()
    const text = draft.trim()
    if (!text || busy || request.current) return
    const user = { role: 'user', content: text }
    let history = messages.slice(-8)
    while (history.length && history.reduce((sum, m) => sum + m.content.length, text.length) > 12000) history = history.slice(2)
    const controller = new AbortController()
    request.current = controller
    setBusy(true)
    setError('')
    try {
      const response = await fetch('/api/penny', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, messages: [...history, user] }),
        signal: controller.signal,
      })
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        throw new Error(typeof payload.error === 'string' ? payload.error : 'The selected connection is unavailable.')
      }
      const reply = (await response.text()).trim()
      if (!reply) throw new Error('No text reply received.')
      if (!controller.signal.aborted) {
        setMessages([...history, user, { role: 'assistant', content: reply.slice(0, 2000) }])
        setDraft('')
      }
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause.message || 'The connection is unavailable.')
    } finally {
      if (request.current === controller) request.current = null
      setBusy(false)
    }
  }
  function open() {
    setClock(new Date())
    if (!dialog.current || dialog.current.open) return
    dialog.current.showModal()
    setDialogOpen(true)
  }
  return (
    <div className={'penny-thought penny-thought--' + placement} data-page-hidden={pageHidden}>
      <button ref={trigger} type="button" className="penny-thought__bubble" onClick={open} aria-haspopup="dialog" aria-expanded={dialogOpen} aria-label={heading + '. Talk to Penny'}>
        <span className="penny-thought__greeting">{heading} ♠</span>
        <span className="penny-thought__quip">{line}</span>
        <span className="penny-thought__hint">Talk to Penny</span>
      </button>
      <dialog ref={dialog} className="penny-thought__dialog" aria-labelledby={titleId} onClose={close} onCancel={() => setDialogOpen(false)}>
        <div className="penny-thought__header">
          {dialogOpen && <span className="penny-thought__avatar" aria-hidden="true"><PennyActiveAvatar /></span>}
          <h2 id={titleId}>♠ Penny · {name}</h2>
          <button type="button" onClick={() => { setDialogOpen(false); dialog.current?.close() }} aria-label="Close conversation">×</button>
        </div>
        <p>{thought ? line : greeting + '! ' + quip}</p>
        {thought && <p className="penny-thought__source">
          {thought.url ? <a href={thought.url} target="_blank" rel="noopener noreferrer">{thought.source} ↗</a> : thought.source}
          {thought.observedAt && <small> · {thought.discoveredBy ? 'Indexed' : 'Source time'} {new Date(thought.observedAt).toLocaleString()}</small>}
          {thought.discoveryUrl && <> · <a href={thought.discoveryUrl} target="_blank" rel="noopener noreferrer">GDELT</a></>}
          {thought.day && <small> · {thought.day}</small>}
        </p>}
        <details className="penny-thought__preferences">
          <summary>Sixth Sense · weather city & zodiac</summary>
          <label>Weather city <select value={awareness.prefs.city} onChange={event=>awareness.choose('city',event.target.value)}>
            {Object.entries(CITIES).map(([key,city])=><option key={key} value={key}>{city.label}</option>)}
          </select></label>
          <label>Daily reflection <select value={awareness.prefs.sign} onChange={event=>awareness.choose('sign',event.target.value)}>
            {SIGNS.map(sign=><option key={sign} value={sign}>{sign}</option>)}
          </select></label>
          <small>Omaha is the WildCard default. No GPS requested. Preferences stay in this browser. Weather is informational; check official warnings. Horoscopes are for entertainment.</small>
        </details>
        <p className="penny-thought__status">Messages you send are processed by {name} when the connection is enabled. Avoid sensitive information. Local greetings do not call the AI.</p>
        <div className="penny-thought__transcript" aria-live="polite">
          {messages.map((message, i) => (
            <div className={'penny-thought__turn penny-thought__turn--' + message.role} key={i}>
              <strong>{message.role === 'user' ? 'You' : 'Penny · ' + name}</strong>
              <p>{message.content}</p>
            </div>
          ))}
          {busy && <p role="status">Connecting to {name}…</p>}
        </div>
        {error && <p className="penny-thought__status" role="alert">{error}</p>}
        <form className="penny-thought__form" onSubmit={send}>
          <textarea aria-label="Message Penny" placeholder={'Talk to Penny via ' + name} rows={2} maxLength={2000} value={draft} disabled={busy} onChange={event => setDraft(event.target.value)} />
          <div className="penny-thought__form-actions">
            <button type="button" disabled={busy} onClick={() => { setMessages([]); setDraft(''); setError('') }}>Clear</button>
            <button type="submit" disabled={busy || !draft.trim()}>Send</button>
          </div>
        </form>
        <a href="https://party.wildcarddev.com/?app=messenger" target="_blank" rel="noopener noreferrer">Open WildCard Messenger</a>
      </dialog>
    </div>
  )
}
