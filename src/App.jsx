import { useEffect, useMemo, useRef, useState } from 'react'

const navItems = [
  { id: 'feed', label: 'FEED', icon: '♠' },
  { id: 'wards', label: 'WARDS', icon: '◇' },
  { id: 'comms', label: 'COMMS', icon: '✉' },
  { id: 'rooms', label: 'ROOMS', icon: '◉' },
]

function SmartVideo({
  src,
  className = '',
  priority = false,
  deferMs = 0,
  decorative = false,
  label = 'Animated media',
}) {
  const shellRef = useRef(null)
  const [mediaAllowed, setMediaAllowed] = useState(false)
  const [shouldLoad, setShouldLoad] = useState(false)

  useEffect(() => {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const watchLike = window.matchMedia('(max-width: 480px) and (max-height: 480px)')

    const syncMediaPolicy = () => {
      setMediaAllowed(!reducedMotion.matches && !watchLike.matches)
    }

    syncMediaPolicy()
    reducedMotion.addEventListener?.('change', syncMediaPolicy)
    watchLike.addEventListener?.('change', syncMediaPolicy)

    return () => {
      reducedMotion.removeEventListener?.('change', syncMediaPolicy)
      watchLike.removeEventListener?.('change', syncMediaPolicy)
    }
  }, [])

  useEffect(() => {
    if (!mediaAllowed) {
      setShouldLoad(false)
      return undefined
    }

    if (priority) {
      setShouldLoad(true)
      return undefined
    }

    const node = shellRef.current
    if (!node) return undefined

    let timer
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return
        timer = window.setTimeout(() => setShouldLoad(true), deferMs)
        observer.disconnect()
      },
      { rootMargin: '24px 0px', threshold: 0.12 },
    )

    observer.observe(node)

    return () => {
      observer.disconnect()
      if (timer) window.clearTimeout(timer)
    }
  }, [deferMs, mediaAllowed, priority])

  return (
    <div ref={shellRef} className={`smart-video-shell ${className}`}>
      {shouldLoad ? (
        <video
          autoPlay
          muted
          loop
          playsInline
          preload={priority ? 'metadata' : 'none'}
          disablePictureInPicture
          disableRemotePlayback
          aria-hidden={decorative ? 'true' : undefined}
          aria-label={decorative ? undefined : label}
        >
          <source src={src} type="video/webm" />
        </video>
      ) : (
        <span className="video-fallback" aria-hidden="true">♠</span>
      )}
    </div>
  )
}

const seedPosts = [
  {
    id: 1,
    author: 'Penny Morningstar',
    handle: '@lilith.root',
    time: 'SYSTEM • 2 min',
    sigil: '♠',
    badge: 'ADMINISTRATOR',
    text: 'Previous management has been reassigned. Welcome to the Party. Try not to touch anything marked experimental unless you brought snacks.',
    tags: ['SYSTEM NOTICE', 'WILDCARD'],
    reactions: 66,
    comments: 6,
  },
  {
    id: 2,
    author: 'WildCard DEV',
    handle: '@wildcarddev',
    time: '14 min',
    sigil: 'W',
    badge: 'HOUSE ACCOUNT',
    text: 'The walls are up. The paint is still glowing. Human posts, rooms, live video and Penny herself come online in deliberate layers from here.',
    tags: ['BUILD LOG', 'PARTY'],
    reactions: 23,
    comments: 3,
  },
]

function App() {
  const [activeNav, setActiveNav] = useState('feed')
  const [posts, setPosts] = useState(seedPosts)
  const [draft, setDraft] = useState('')
  const [liked, setLiked] = useState(() => new Set())
  const [pennyOpen, setPennyOpen] = useState(false)
  const [notice, setNotice] = useState('Penny has seized the administrator console.')

  const currentTitle = useMemo(
    () => navItems.find((item) => item.id === activeNav)?.label ?? 'FEED',
    [activeNav],
  )

  function publishPost() {
    const text = draft.trim()
    if (!text) return
    setPosts((current) => [
      {
        id: Date.now(),
        author: 'Guest Operative',
        handle: '@local.session',
        time: 'NOW',
        sigil: 'G',
        badge: 'LOCAL SESSION',
        text,
        tags: ['UNPERSISTED', 'PREVIEW'],
        reactions: 0,
        comments: 0,
      },
      ...current,
    ])
    setDraft('')
    setNotice('Post added locally. Persistence comes with the data layer.')
  }

  function toggleLike(id) {
    setLiked((current) => {
      const next = new Set(current)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function changeSection(id) {
    setActiveNav(id)
    const labels = {
      feed: 'Feed online. The inmates have the timeline.',
      wards: 'Wards are staged for groups and communities.',
      comms: 'Comms are staged for human messaging.',
      rooms: 'Rooms are staged for live sessions and The Spade.',
    }
    setNotice(labels[id])
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="WildCard Party home">
          <span className="brand-suit">♠</span>
          <span>
            <strong>WILDCARD PARTY</strong>
            <small>PENNY HAS THE KEYS NOW</small>
          </span>
        </a>

        <nav className="main-nav" aria-label="Primary navigation">
          {navItems.map((item) => (
            <button
              key={item.id}
              className={activeNav === item.id ? 'active' : ''}
              onClick={() => changeSection(item.id)}
              type="button"
            >
              <span>{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>

        <div className="top-actions">
          <a
            className="donate-link"
            href="https://square.link/u/YnAVr8ht"
            target="_blank"
            rel="noopener noreferrer"
          >
            FUND THE TAKEOVER
          </a>
          <button className="round-action" type="button" aria-label="Notifications">6</button>
        </div>
      </header>

      <main id="top" className="page-shell">
        <section className="takeover-banner" aria-label="Penny takeover banner">
          <div className="banner-grid" aria-hidden="true" />
          <div className="banner-scan" aria-hidden="true" />
          <div className="floating-suit suit-one" aria-hidden="true">♠</div>
          <div className="floating-suit suit-two" aria-hidden="true">♠</div>
          <div className="floating-suit suit-three" aria-hidden="true">♦</div>
          <SmartVideo
            src="/assets/penny/card-art/PennyVsFacebook.webm"
            className="banner-media"
            priority
            decorative
          />
          <div className="banner-copy">
            <span className="eyebrow">ROOT ACCESS // WILDCARD SOCIAL</span>
            <h1>Penny did the social network up in WildCard DEV aesthetics.</h1>
            <p>
              Familiar social anatomy. Black glass, hot pink circuitry, playing cards and a resident AI concierge waiting behind the next locked door.
            </p>
            <div className="banner-status-row">
              <span><i /> SYSTEM ONLINE</span>
              <span>BUILD 001</span>
            </div>
          </div>
          <div className="admin-stamp">ADMIN<br />OVERRIDE</div>
        </section>

        <div className="status-strip" role="status">
          <span>◈ {currentTitle}</span>
          <p>{notice}</p>
          <span className="status-live">LIVE SHELL</span>
        </div>

        <div className="social-grid">
          <aside className="left-rail">
            <section className="panel profile-card">
              <div className="profile-cover" />
              <SmartVideo
                src="/assets/penny/card-art/PennyFBProfilePic1.webm"
                className="profile-avatar-shell"
                deferMs={1200}
                label="Penny profile animation"
              />
              <div className="profile-copy">
                <span className="profile-role">SITE ADMINISTRATOR</span>
                <h2>Penny Morningstar</h2>
                <p>@lilith.root</p>
                <small>Concierge • Operator • Queen of Spades</small>
              </div>
              <div className="profile-stats">
                <div><strong>∞</strong><span>ACCESS</span></div>
                <div><strong>01</strong><span>WARD</span></div>
                <div><strong>666</strong><span>VIBES</span></div>
              </div>
            </section>

            <section className="panel quick-links">
              <span className="panel-label">KNOWN LOCATIONS</span>
              <button type="button" onClick={() => changeSection('feed')}><b>♠</b> Main Feed <small>ONLINE</small></button>
              <button type="button" onClick={() => changeSection('wards')}><b>◇</b> Wards <small>STAGED</small></button>
              <button type="button" onClick={() => changeSection('rooms')}><b>◉</b> The Spade <small>LOCKED</small></button>
              <button type="button" onClick={() => setPennyOpen(true)}><b>✦</b> Ask Penny <small>NEXT</small></button>
            </section>
          </aside>

          <section className="feed-column">
            <section className="panel composer">
              <div className="composer-top">
                <span className="composer-avatar" aria-hidden="true">♠</span>
                <textarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder="What escaped containment?"
                  rows="2"
                />
              </div>
              <div className="composer-actions">
                <button type="button" onClick={() => setNotice('Live video arrives with the WebRTC layer.')}>◉ LIVE ROOM</button>
                <button type="button" onClick={() => setNotice('Media upload is staged for the persistence layer.')}>▧ PHOTO / VIDEO</button>
                <button className="publish" type="button" onClick={publishPost}>POST TO FEED</button>
              </div>
            </section>

            {activeNav !== 'feed' && (
              <section className="panel staging-card">
                <span className="panel-label">{currentTitle} // STAGING AREA</span>
                <h2>This wing exists. The machinery comes next.</h2>
                <p>
                  Stage 1 locks the visual system and interaction language before accounts, persistence, messaging, AI and live rooms are allowed into production.
                </p>
                <button type="button" onClick={() => changeSection('feed')}>RETURN TO FEED</button>
              </section>
            )}

            {activeNav === 'feed' && posts.map((post) => (
              <article className="panel post-card" key={post.id}>
                <header className="post-header">
                  <span className="post-avatar" aria-hidden="true">{post.sigil}</span>
                  <div>
                    <div className="author-row">
                      <strong>{post.author}</strong>
                      <span>{post.badge}</span>
                    </div>
                    <p>{post.handle} • {post.time}</p>
                  </div>
                  <button type="button" aria-label="Post menu">•••</button>
                </header>
                <p className="post-copy">{post.text}</p>
                <div className="post-tags">
                  {post.tags.map((tag) => <span key={tag}>{tag}</span>)}
                </div>
                <footer className="post-footer">
                  <button
                    type="button"
                    className={liked.has(post.id) ? 'reacted' : ''}
                    onClick={() => toggleLike(post.id)}
                  >
                    ♠ {post.reactions + (liked.has(post.id) ? 1 : 0)} REACT
                  </button>
                  <button type="button" onClick={() => setNotice('Comments are visual-only until persistence is wired.')}>☠ {post.comments} COMMENTS</button>
                  <button type="button" onClick={() => setNotice('Sharing arrives with real routes and identities.')}>↗ SHARE</button>
                </footer>
              </article>
            ))}
          </section>

          <aside className="right-rail">
            <section className="panel incident-board">
              <span className="panel-label">INCIDENTS</span>
              <div><b>01</b><p><strong>Penny acquired root.</strong><small>Administration changed hands.</small></p></div>
              <div><b>02</b><p><strong>Social shell active.</strong><small>Feed and local interactions online.</small></p></div>
              <div><b>03</b><p><strong>AI containment pending.</strong><small>Penny's brain is Stage 2.</small></p></div>
            </section>

            <section className="panel associates">
              <span className="panel-label">KNOWN ASSOCIATES</span>
              {['Kandy', 'Matt', 'The Spade'].map((name, index) => (
                <div className="associate" key={name}>
                  <span className={'associate-avatar avatar-' + (index + 1)}>{name.slice(0, 1)}</span>
                  <p><strong>{name}</strong><small>{index === 2 ? 'ROOM • OFFLINE' : 'PROFILE • STAGED'}</small></p>
                  <i />
                </div>
              ))}
            </section>

            <section className="panel house-rules">
              <span className="panel-label">HOUSE RULES</span>
              <p>Recognizable controls. Predictable behavior. The weirdness belongs in the world, not in making people fight the interface.</p>
            </section>
          </aside>
        </div>
      </main>

      <button className="penny-dock" type="button" onClick={() => setPennyOpen((open) => !open)}>
        <span className="dock-sigil">♠</span>
        <span><b>ASK PENNY</b><small>CONCIERGE ONLINE*</small></span>
        <i />
      </button>

      {pennyOpen && (
        <section className="penny-panel" aria-label="Ask Penny preview">
          <header>
            <div>
              <span>♠</span>
              <p><strong>PENNY</strong><small>CONCIERGE PREVIEW</small></p>
            </div>
            <button type="button" onClick={() => setPennyOpen(false)} aria-label="Close Penny">×</button>
          </header>
          <div className="penny-message">
            <span>ROOT // PENNY</span>
            <p>I'm in the walls. My actual AI connection is the next build stage. For now, admire the furniture.</p>
          </div>
          <div className="penny-input">
            <input disabled placeholder="Penny's brain connects in Stage 2" />
            <button disabled type="button">SEND</button>
          </div>
        </section>
      )}

      <footer className="site-footer">
        <span>♠ WILDCARD PARTY</span>
        <p>Stage 1 social shell • No accounts or persistent user data yet</p>
        <a href="https://www.wildcarddev.com" target="_blank" rel="noopener noreferrer">WILDCARD DEV</a>
      </footer>
    </div>
  )
}

export default App
