import { useEffect, useState } from 'react'
import OwnerMedia from './OwnerMedia.jsx'

const AREAS = ['penny', 'kandy', 'ashley']
const styles = {
  page: { minHeight: '100dvh', background: '#110b1c', color: '#fbeaf5', padding: 'clamp(16px, 5vw, 48px)', font: '16px/1.6 system-ui,sans-serif' },
  panel: { maxWidth: 920, margin: '16px auto', padding: 20, border: '1px solid #99688f', borderRadius: 16, background: '#22152c' },
  input: { background: '#120b1d', color: 'white', border: '1px solid #906981', borderRadius: 8, padding: 10, minWidth: 0 },
  button: { color: '#13071b', background: '#ffb8e4', border: 0, borderRadius: 8, padding: '9px 14px', cursor: 'pointer' },
}

async function request(method, body, query = '') {
  const response = await fetch('/api/afterhours/admin' + query, {
    method, credentials: 'same-origin', cache: 'no-store',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(data.error || 'Operation failed.')
    error.status = response.status
    throw error
  }
  return data
}

export default function OwnerAccess() {
  const [members, setMembers] = useState([])
  const [search, setSearch] = useState('')
  const [form, setForm] = useState({ handle: '', displayName: '', password: '' })
  const [reset, setReset] = useState({ id: '', password: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [denied, setDenied] = useState(false)

  async function refresh(query = search) {
    try {
      const data = await request('GET', null, '?q=' + encodeURIComponent(query))
      setDenied(false)
      setMembers(data.members)
    } catch (err) {
      if (err.status === 401 || err.status === 403) setDenied(true)
      setError(err.message)
    }
  }

  useEffect(() => { refresh('') }, [])

  async function perform(body, message) {
    setBusy(true); setError(''); setNotice('')
    try {
      const pending = request('POST', body)
      if (window.WildCardLoader?.track) {
        await window.WildCardLoader.track(pending, { label: 'Updating member access…' })
      } else {
        await pending
      }
      setNotice(message)
      await refresh()
      return true
    } catch (err) {
      setError(err.message)
      return false
    } finally { setBusy(false) }
  }

  return <main style={styles.page}>
    <header style={{ maxWidth: 920, margin: 'auto' }}>
      <a href="/?app=messenger" style={{ color: '#ffb8e4' }}>← WildCard Messenger</a>
      <h1>♠ After Hours · Owner Gate</h1>
      <p>Access is denied by default. Only your existing Messenger Owner account can manage memberships.</p>
    </header>
    {denied ? <section style={styles.panel}>
      <p role="alert">Sign in to your Owner account using WildCard Messenger to manage access.</p>
      <a href="/?app=messenger" style={{ color: '#ffb8e4' }}>Open Messenger sign-in</a>
    </section> : <>
      {error && <p role="alert" style={{ color: '#ffb6ac', maxWidth: 920, margin: 'auto' }}>{error}</p>}
      {notice && <p role="status" style={{ color: '#caff9d', maxWidth: 920, margin: 'auto' }}>{notice}</p>}
      <section style={styles.panel}>
        <h2>Create a Messenger member</h2>
        <form onSubmit={async event => {
          event.preventDefault()
          if (await perform({ action: 'create', ...form }, 'Member created. Access remains locked until you grant it.')) {
            setForm({ handle: '', displayName: '', password: '' })
          }
        }} style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <input style={styles.input} aria-label="Username" placeholder="username" required value={form.handle} onChange={e => setForm({ ...form, handle: e.target.value })} />
          <input style={styles.input} aria-label="Display name" placeholder="Display name" required value={form.displayName} onChange={e => setForm({ ...form, displayName: e.target.value })} />
          <input style={styles.input} aria-label="Temporary password" type="password" autoComplete="new-password" minLength={10} placeholder="Temporary password" required value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} />
          <button style={styles.button} disabled={busy}>Create member</button>
        </form>
      </section>
      <OwnerMedia />
      <section style={styles.panel}>
        <h2>Member permissions</h2>
        <form onSubmit={e => { e.preventDefault(); refresh() }} style={{ display: 'flex', gap: 8 }}>
          <input style={{ ...styles.input, flex: 1 }} aria-label="Find member" placeholder="Search username or name" value={search} onChange={e => setSearch(e.target.value)} />
          <button type="submit" style={styles.button} disabled={busy}>Find</button>
        </form>
        <p>Showing up to 60 matching accounts. Each switch is independent.</p>
        {members.map(member => <article key={member.id} style={{ padding: '12px 0', borderTop: '1px solid #5b3e61' }}>
          <strong>@{member.handle}</strong> <span>({member.displayName})</span>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
            {AREAS.map(area => {
              const allowed = member.areas.includes(area)
              return <button type="button" key={area} disabled={busy} style={{ ...styles.button, background: allowed ? '#baff91' : '#e2cada' }}
                aria-label={area + ' access for ' + member.handle + ': ' + (allowed ? 'approved' : 'locked')}
                onClick={() => perform({ action: allowed ? 'revoke' : 'grant', accountId: member.id, area }, (allowed ? 'Revoked ' : 'Granted ') + area + ' access for @' + member.handle)}>
                {area.toUpperCase()} {allowed ? '✓ Approved' : '🔒 Locked'}
              </button>
            })}
            <button type="button" style={{ ...styles.button, background: '#d0a8d0' }} onClick={() => setReset({ id: member.id, password: '' })}>Reset password</button>
          </div>
          {reset.id === member.id && <form onSubmit={async e => {
            e.preventDefault()
            if (await perform({ action: 'reset-password', accountId: member.id, password: reset.password }, 'Password reset; all existing sessions revoked. Share the new password privately.')) setReset({ id: '', password: '' })
          }} style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <input style={styles.input} type="password" aria-label={'New password for ' + member.handle} autoComplete="new-password" minLength={10} required value={reset.password} onChange={e => setReset({ ...reset, password: e.target.value })} placeholder="New temporary password" />
            <button style={styles.button} disabled={busy}>Save new password</button>
            <button type="button" style={styles.button} onClick={() => setReset({ id: '', password: '' })}>Cancel</button>
          </form>}
        </article>)}
      </section>
    </>}
  </main>
}
