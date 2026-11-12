import { useEffect, useRef, useState } from 'react'
import CommsPanel from './CommsPanel.jsx'
import './messenger.css'

async function authRequest(path, options = {}) {
  const response = await fetch(path, { ...options, credentials: 'same-origin', cache: 'no-store' })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.error || 'Account request failed.')
  return payload
}

export default function Messenger() {
  const [account, setAccount] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [handle, setHandle] = useState('')
  const [password, setPassword] = useState('')
  const [unread, setUnread] = useState(0)
  const handleRef = useRef(null)
  const pending = useRef(false)

  useEffect(() => {
    const controller = new AbortController()
    document.title = 'WildCard Messenger | WildCard Party'
    authRequest('/api/auth/me', { signal: controller.signal })
      .then(payload => { if (!controller.signal.aborted) setAccount(payload.account || null) })
      .catch(err => { if (!controller.signal.aborted) setError(err.message) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [])

  async function signIn(event) {
    event.preventDefault()
    if (pending.current) return
    pending.current = true
    setBusy(true)
    setError('')
    try {
      const payload = await authRequest('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handle, password }),
      })
      if (!payload.account?.id) throw new Error('No account was returned.')
      setAccount(payload.account)
      setPassword('')
    } catch (err) {
      setError(err.message)
    } finally {
      pending.current = false
      setBusy(false)
    }
  }

  async function signOut() {
    if (pending.current) return
    pending.current = true
    setBusy(true)
    setError('')
    try {
      await authRequest('/api/auth/logout', { method: 'POST' })
      setAccount(null)
      setUnread(0)
      setPassword('')
    } catch (err) {
      setError(err.message)
    } finally {
      pending.current = false
      setBusy(false)
    }
  }

  return (
    <main className="messenger-app">
      <header className="messenger-header">
        <a href="/" className="messenger-home">♠ WildCard Party</a>
        <div><h1>WildCard Messenger</h1><p>Private text conversations</p></div>
        {account && <button type="button" onClick={signOut} disabled={busy}>Sign out</button>}
      </header>
      {error && <p className="messenger-error" role="alert">{error}</p>}
      {!loading && !account && (
        <form className="messenger-login" onSubmit={signIn}>
          <h2>Sign in with your WildCard Party account</h2>
          <label>Handle<input ref={handleRef} autoComplete="username" value={handle} onChange={e => setHandle(e.target.value.toLowerCase())} pattern="[a-z0-9_]{3,24}" maxLength={24} required /></label>
          <label>Password<input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} maxLength={128} required /></label>
          <button type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
          <p>Need an account? <a href="/">Open WildCard Party.</a></p>
        </form>
      )}
      {account && <p className="messenger-status" aria-live="polite">{unread} unread {unread === 1 ? 'message' : 'messages'}</p>}
      {(account || loading) && <CommsPanel key={account?.id || 'loading'} account={account} accountLoading={loading} onRequireSignIn={() => handleRef.current?.focus()} onUnreadCountChange={setUnread} textOnly />}
      <footer>WildCard DEV · Existing Party identity · Text-only workspace</footer>
    </main>
  )
}
