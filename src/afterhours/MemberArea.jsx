import { useEffect, useState } from 'react'

const AREAS = ['penny', 'kandy', 'ashley']
const STYLES = { background: '#140a21', color: '#fff0fb', minHeight: '100dvh', padding: 'clamp(20px, 5vw, 44px)', font: '16px/1.7 system-ui,sans-serif' }

export default function MemberArea() {
  const area = new URLSearchParams(window.location.search).get('area') || ''
  const [status, setStatus] = useState('checking')
  const [media, setMedia] = useState([])
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    if (!AREAS.includes(area)) { setStatus('invalid'); return undefined }
    let cancelled = false
    async function check() {
      setStatus('checking')
      try {
        const access = await fetch('/api/afterhours/access?area=' + area, {
          credentials: 'same-origin', cache: 'no-store',
        })
        if (!access.ok) {
          if (!cancelled) setStatus(access.status === 401 ? 'login' : access.status === 403 ? 'denied' : 'unavailable')
          return
        }
        const response = await fetch('/api/afterhours/media?area=' + area, {
          credentials: 'same-origin', cache: 'no-store',
        })
        if (!response.ok) throw new Error('Media service unavailable')
        const result = await response.json()
        if (!cancelled) {
          setMedia(Array.isArray(result.media) ? result.media : [])
          setStatus('approved')
        }
      } catch {
        if (!cancelled) setStatus('unavailable')
      }
    }
    check()
    return () => { cancelled = true }
  }, [area, retry])

  const name = area ? area[0].toUpperCase() + area.slice(1) : 'WildCard'
  return <main style={STYLES}>
    <header style={{ maxWidth: 1000, margin: 'auto' }}>
      <p style={{ letterSpacing: '.16em' }}>♠ WILDCARD DEV · MEMBERS</p>
      <h1>{name}'s Private Vault</h1>
      {status === 'checking' && <p role="status">Checking your Messenger membership…</p>}
      {status === 'invalid' && <p>That area does not exist.</p>}
      {status === 'login' && <p>Sign in to WildCard Messenger to enter.</p>}
      {status === 'denied' && <p>Owner approval is required for this area.</p>}
      {status === 'unavailable' && <p>Access could not be verified. This vault remains locked.</p>}
      {status !== 'approved' && <div style={{ display: 'flex', gap: 16 }}>
        <a href="/?app=messenger" target="_blank" rel="noopener noreferrer" style={{ color: '#ffbfe7' }}>Sign in to Messenger</a>
        <button type="button" onClick={() => setRetry(i => i + 1)}>Check again</button>
      </div>}
      {status === 'approved' && (media.length ? <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,270px),1fr))', gap: 20 }}>
        {media.map(item => <figure key={item.id} style={{ margin: 0, padding: 12, border: '1px solid #805478', borderRadius: 14 }}>
          {item.type.startsWith('video/') ? <video controls playsInline preload="none" style={{ width: '100%' }}
            src={'/api/afterhours/media?id=' + item.id} /> :
            <img style={{ width: '100%', height: 'auto' }} loading="lazy" alt={item.name}
              src={'/api/afterhours/media?id=' + item.id} />}
          <figcaption>{item.name}</figcaption>
        </figure>)}
      </div> : <p>Membership approved. The Owner has not uploaded private media for this area yet.</p>)}
    </header>
  </main>
}
