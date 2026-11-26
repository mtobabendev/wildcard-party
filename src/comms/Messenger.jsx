import { useEffect, useRef, useState } from 'react'
import CommsPanel from './CommsPanel.jsx'
import PennyCore from './PennyCore.jsx'
import './messenger.css'

async function request(path, options = {}) {
  const response = await fetch(path, { ...options, credentials: 'same-origin', cache: 'no-store' })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.error || 'Messenger request failed.')
  return payload
}

export default function Messenger({ embedded = false, onStatus } = {}) {
  const [account, setAccount] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [handle, setHandle] = useState('')
  const [password, setPassword] = useState('')
  const [unread, setUnread] = useState(0)
  const [view, setView] = useState('comms')
  const formRef = useRef(null)

  useEffect(() => {
    const previousTitle = document.title
    document.title = 'WildCard Messenger'
    const controller = new AbortController()
    request('/api/auth/me', { signal: controller.signal })
      .then(payload => { if (!controller.signal.aborted) { setAccount(payload.account || null); if (!payload.account) onStatus?.(0, false) } })
      .catch(err => { if (!controller.signal.aborted) setError(err.message) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => { controller.abort(); document.title = previousTitle }
  }, [])

  async function signIn(event) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const login = request('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handle, password }),
      })
      const payload = window.WildCardLoader?.track
        ? await window.WildCardLoader.track(login, { label: 'Signing in to WildCard Messenger…' })
        : await login
      if (!payload.account?.id) throw new Error('Account was not returned.')
      setAccount(payload.account)
      onStatus?.(0, true)
      setPassword('')
    } catch (err) { setError(err.message) }
    finally { setBusy(false) }
  }

  async function signOut() {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await request('/api/auth/logout', { method: 'POST' })
      setAccount(null)
      setUnread(0)
      onStatus?.(0, false)
      setView('comms')
      setPassword('')
    } catch (err) { setError(err.message) }
    finally { setBusy(false) }
  }

  return (
    <main className={embedded ? "messenger-app messenger-app--embedded" : "messenger-app"}>
      <header className="messenger-bar">
        <div><span className="messenger-brand">♠ WILDCARD MESSENGER</span>
          <small>PRIVATE COMMS{account && unread > 0 ? ' · ' + unread + ' unread' : ''}</small></div>
        <nav aria-label="Messenger navigation">
          {!embedded && <a href="/">Party</a>}
          {!embedded && <a href="https://www.wildcarddev.com/">WildCard DEV</a>}
          {account && <>
            <button type="button" aria-pressed={view === 'comms'} onClick={() => setView('comms')}>Messages</button>
            {!embedded && <button type="button" aria-pressed={view === 'penny'} onClick={() => setView('penny')}>Penny Core</button>}
            <button type="button" disabled={busy} onClick={signOut}>Sign out</button>
          </>}
        </nav>
      </header>
      {error && <p className="messenger-error" role="alert">{error}</p>}
      {loading ? <p role="status">Checking your WildCard session…</p> : !account ? (
        <form className="messenger-login panel" ref={formRef} onSubmit={signIn}>
          <h1>Sign in to Messenger</h1>
          <p>Use your existing WildCard Party account.</p>
          <label>Handle<input required autoComplete="username" value={handle} onChange={e => setHandle(e.target.value)} /></label>
          <label>Password<input required type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} /></label>
          <button type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
          <a href="https://party.wildcarddev.com/" target={embedded ? "_blank" : undefined} rel="noopener noreferrer">Create an account in WildCard Party</a>
        </form>
      ) : view === 'penny' ? (
        <PennyCore key={account.id} />
      ) : (
        <CommsPanel key={account.id} account={account} accountLoading={false}
          onRequireSignIn={() => { setAccount(null); setUnread(0); onStatus?.(0, false) }}
          allowCalls={!embedded} onUnreadCountChange={count => { setUnread(count); onStatus?.(count, true) }} />
      )}
    </main>
  )
}
