import { useEffect, useRef, useState } from 'react'
import { groupPrivateMedia } from './mediaCollections.js'
import './MemberArea.css'

const AREAS = ['penny', 'kandy', 'ashley']
const VIEWS = ['galleries', 'reels']

function mediaSrc(id) {
  return '/api/afterhours/media?id=' + encodeURIComponent(id)
}

function initialView() {
  const view = new URLSearchParams(window.location.search).get('view')
  return VIEWS.includes(view) ? view : 'galleries'
}

export default function MemberArea() {
  const area = new URLSearchParams(window.location.search).get('area') || ''
  const embedded = new URLSearchParams(window.location.search).get('embed') === '1'
  const [status, setStatus] = useState('checking')
  const [media, setMedia] = useState([])
  const [view, setView] = useState(initialView)
  const [retry, setRetry] = useState(0)
  const [viewer, setViewer] = useState(null)
  const [owner, setOwner] = useState(false)
  const [removing, setRemoving] = useState(false)
  const dialogRef = useRef(null)
  const touchRef = useRef(null)
  const containerRef = useRef(null)

  useEffect(() => {
    if (!AREAS.includes(area)) { setStatus('invalid'); setMedia([]); return undefined }
    let cancelled = false
    async function check() {
      setStatus('checking')
      setMedia([])
      setViewer(null)
      try {
        const access = await fetch('/api/afterhours/access?area=' + area, {
          credentials: 'same-origin', cache: 'no-store',
        })
        if (!access.ok) {
          if (!cancelled) setStatus(access.status === 401 ? 'login' : access.status === 403 ? 'denied' : 'unavailable')
          return
        }
        const membership = await access.json()
        if (!cancelled) setOwner(membership.owner === true)
        const response = await fetch('/api/afterhours/media?area=' + area, {
          credentials: 'same-origin', cache: 'no-store',
        })
        if (!response.ok) throw new Error('Private media service unavailable')
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

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (viewer && !dialog.open) dialog.showModal()
    if (!viewer && dialog.open) dialog.close()
  }, [viewer])

  // The vault remains on Party's authenticated origin, even when displayed inside Penny's page.
  // Only the frame height is shared with the known WildCard site origins; no account or media data.
  useEffect(() => {
    if (!embedded || window.parent === window) return undefined
    const reportHeight = () => {
      const height = Math.ceil(containerRef.current?.getBoundingClientRect().height || 0) + 48
      if (!Number.isFinite(height) || height < 200) return
      const message = { type: 'wildcard:afterhours:height:v1', area, height }
      for (const origin of ['https://wildcarddev.com', 'https://www.wildcarddev.com']) {
        window.parent.postMessage(message, origin)
      }
    }
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(reportHeight)
    if (containerRef.current) observer?.observe(containerRef.current)
    const frame = window.requestAnimationFrame(reportHeight)
    window.addEventListener('resize', reportHeight)
    return () => {
      observer?.disconnect()
      window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', reportHeight)
    }
  }, [area, embedded])

  function changeView(next) {
    if (!VIEWS.includes(next)) return
    setView(next)
    setViewer(null)
    const url = new URL(window.location.href)
    url.searchParams.set('view', next)
    window.history.replaceState(null, '', url)
  }

  async function removeCurrent() {
    if (!owner || removing || !current) return
    if (!window.confirm('Remove ' + current.displayName + ' from ' + current.collection + '?')) return
    setRemoving(true)
    try {
      const response = await fetch('/api/afterhours/media-admin', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'remove', area, id: current.id, name: current.name }),
      })
      if (!response.ok) throw new Error('Removal failed')
      setViewer(null)
      setRetry(value => value + 1)
    } catch {
      window.alert('Removal failed. No successful removal was confirmed.')
    } finally {
      setRemoving(false)
    }
  }

  function navigate(direction) {
    setViewer(current => {
      if (!current || current.items.length < 2) return current
      return { ...current, index: (current.index + direction + current.items.length) % current.items.length }
    })
  }

  function startTouch(event) {
    if (event.touches.length !== 1) { touchRef.current = null; return }
    touchRef.current = { x: event.touches[0].clientX, y: event.touches[0].clientY }
  }

  function endTouch(event) {
    const start = touchRef.current
    touchRef.current = null
    if (!start || !event.changedTouches.length) return
    const dx = event.changedTouches[0].clientX - start.x
    const dy = event.changedTouches[0].clientY - start.y
    if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.3) navigate(dx < 0 ? 1 : -1)
  }

  const groups = status === 'approved' ? groupPrivateMedia(media, view) : []
  const photos = status === 'approved' ? media.filter(item => item?.type?.startsWith('image/')).length : 0
  const reels = status === 'approved' ? media.filter(item => item?.type?.startsWith('video/')).length : 0
  const name = area ? area[0].toUpperCase() + area.slice(1) : 'WildCard'
  const current = viewer?.items?.[viewer.index]

  return <main className={embedded ? "vault vault--embedded" : "vault"}>
    <div className="vault__shell" ref={containerRef}>
      {!embedded && <header>
        <p className="vault__breadcrumb">♠ WildCard DEV · Approved Members</p>
        <h1 className="vault__title">{name}'s Private Vault</h1>
        <p className="vault__subtitle">Private galleries and reels for members approved by WildCard DEV.</p>
        {area === 'penny' && <p><a href="https://www.wildcarddev.com/penny/after-hours">← Back to Penny After Hours</a></p>}
      </header>}

      {status !== 'approved' && <div className="vault__status">
        {status === 'checking' && <p role="status">Checking your Messenger membership…</p>}
        {status === 'invalid' && <p>This private area does not exist.</p>}
        {status === 'login' && <p>Sign in to WildCard Messenger before entering.</p>}
        {status === 'denied' && <p>Owner approval is required for this area.</p>}
        {status === 'unavailable' && <p>Access could not be verified. This vault remains locked.</p>}
        <a href="/?app=messenger" target="_blank" rel="noopener noreferrer">Open Messenger</a>
        <button type="button" onClick={() => setRetry(value => value + 1)}>Check again</button>
      </div>}

      {status === 'approved' && <>
        {!embedded && <nav className="vault__tabs" aria-label="Private media categories">
          <button type="button" aria-pressed={view === 'galleries'} onClick={() => changeView('galleries')}>
            🖼️ Galleries <span>{photos}</span>
          </button>
          <button type="button" aria-pressed={view === 'reels'} onClick={() => changeView('reels')}>
            ▶ Reels &amp; Videos <span>{reels}</span>
          </button>
          <button className="vault__refresh" type="button" onClick={() => setRetry(value => value + 1)}>
            ↻ Refresh collection
          </button>
        </nav>}
        {groups.length === 0 && <p className="vault__empty">
          {view === 'galleries'
            ? 'No media is published in this gallery yet. New private gallery uploads appear here automatically.'
            : 'No videos are published here yet. New private video uploads appear here automatically.'}
        </p>}
        {groups.map(group => <section className="vault__collection" key={group.name} aria-label={group.name}>
          <h2>{group.name}</h2>
          <p>{group.items.length} {view === 'galleries' ? 'items' : 'clips'} · Tap to enlarge. Swipe or use arrows to browse.</p>
          <div className="vault__grid">
            {group.items.map((item, index) => <button className="vault__tile" key={item.id}
              type="button" onClick={() => setViewer({ items: group.items, index })}
              aria-label={'Open ' + item.title}>
              <span className="vault__image-wrap">
                {item.type.startsWith('image/')
                  ? <img loading="lazy" decoding="async" src={mediaSrc(item.id)} alt="" />
                  : <video muted playsInline preload="metadata" src={mediaSrc(item.id)} aria-hidden="true" tabIndex={-1} />}
                {item.type.startsWith('video/') && <span className="vault__play" aria-hidden="true">▶</span>}
              </span>
              <span className="vault__tile-title">{item.title}</span>
            </button>)}
          </div>
        </section>)}
      </>}
    </div>

    <dialog className="vault__viewer" ref={dialogRef} aria-label="Private media viewer"
      onClose={() => setViewer(null)}
      onClick={event => { if (event.target === event.currentTarget) setViewer(null) }}
      onKeyDown={event => {
        if (event.target.tagName === 'VIDEO') return
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          event.preventDefault()
          navigate(event.key === 'ArrowRight' ? 1 : -1)
        }
      }}>
      {status === 'approved' && current && <div className="vault__viewer-inner">
        <header className="vault__viewer-header">
          <strong>{current.title} · {current.collection}</strong>
          {owner && <button type="button" disabled={removing} onClick={removeCurrent}>{removing ? "Removing…" : "Remove clip"}</button>}
          <button type="button" onClick={() => setViewer(null)} aria-label="Close viewer">✕ Close</button>
        </header>
        <div className="vault__viewer-stage" onTouchStart={startTouch} onTouchEnd={endTouch}
          onTouchCancel={() => { touchRef.current = null }}>
          {current.type.startsWith('video/')
            ? <video key={current.id} controls playsInline loop preload="metadata" src={mediaSrc(current.id)} aria-label={current.title} />
            : <img key={current.id} src={mediaSrc(current.id)} alt={current.title} />}
        </div>
        <nav className="vault__viewer-footer" aria-label="Gallery navigation">
          <button type="button" onClick={() => navigate(-1)} disabled={viewer.items.length < 2}>← Previous</button>
          <span>{viewer.index + 1} / {viewer.items.length}</span>
          <button type="button" onClick={() => navigate(1)} disabled={viewer.items.length < 2}>Next →</button>
        </nav>
      </div>}
    </dialog>
  </main>
}
