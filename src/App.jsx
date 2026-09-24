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
    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection

    const syncMediaPolicy = () => {
      setMediaAllowed(
        !reducedMotion.matches &&
        !watchLike.matches &&
        !connection?.saveData
      )
    }

    syncMediaPolicy()
    reducedMotion.addEventListener?.('change', syncMediaPolicy)
    watchLike.addEventListener?.('change', syncMediaPolicy)
    connection?.addEventListener?.('change', syncMediaPolicy)

    return () => {
      reducedMotion.removeEventListener?.('change', syncMediaPolicy)
      watchLike.removeEventListener?.('change', syncMediaPolicy)
      connection?.removeEventListener?.('change', syncMediaPolicy)
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

const PENNY_SESSION_KEY = 'wildcard-party:penny-session-v1'
const SOCIAL_OWNER_KEY = 'wildcard-party:social-owner-v1'

function getSocialOwnerToken() {
  try {
    const existing = window.localStorage.getItem(SOCIAL_OWNER_KEY)
    if (existing && existing.length >= 32) return existing

    const bytes = new Uint8Array(32)
    window.crypto.getRandomValues(bytes)
    const token = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
    window.localStorage.setItem(SOCIAL_OWNER_KEY, token)
    return token
  } catch {
    return ''
  }
}

function relativeTime(value) {
  const stamp = new Date(value).getTime()
  if (!Number.isFinite(stamp)) return 'NOW'

  const seconds = Math.max(0, Math.floor((Date.now() - stamp) / 1000))
  if (seconds < 60) return 'NOW'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  return `${days}d`
}

function persistentPostFromApi(post) {
  return {
    id: post.id,
    author: post.authorName,
    handle: post.authorHandle,
    time: relativeTime(post.createdAt),
    sigil: 'G',
    badge: 'GUEST OPERATIVE',
    text: post.body,
    tags: ['PERSISTED', 'PARTY'],
    reactions: 0,
    comments: post.commentCount ?? 0,
    persisted: true,
    owned: Boolean(post.owned),
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
  }
}

function loadPennyMessages() {
  try {
    const raw = window.sessionStorage.getItem(PENNY_SESSION_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((message) => (
        (message?.role === 'user' || message?.role === 'assistant') &&
        typeof message?.text === 'string'
      ))
      .slice(-20)
  } catch {
    return []
  }
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
  const [feedBusy, setFeedBusy] = useState(false)
  const [feedLoading, setFeedLoading] = useState(true)
  const [feedError, setFeedError] = useState('')
  const [liked, setLiked] = useState(() => new Set())
  const [openComments, setOpenComments] = useState(() => new Set())
  const [commentsByPost, setCommentsByPost] = useState({})
  const [commentDrafts, setCommentDrafts] = useState({})
  const [commentBusy, setCommentBusy] = useState(() => new Set())
  const [editingPostId, setEditingPostId] = useState('')
  const [editDraft, setEditDraft] = useState('')
  const ownerTokenRef = useRef('')
  const [account, setAccount] = useState(null)
  const [accountLoading, setAccountLoading] = useState(true)
  const [accountOpen, setAccountOpen] = useState(false)
  const [accountMode, setAccountMode] = useState('login')
  const [accountBusy, setAccountBusy] = useState(false)
  const [accountError, setAccountError] = useState('')
  const [accountForm, setAccountForm] = useState({
    displayName: '',
    handle: '',
    password: '',
    bio: '',
  })
  const [pennyOpen, setPennyOpen] = useState(false)
  const [pennyDraft, setPennyDraft] = useState('')
  const [pennyMessages, setPennyMessages] = useState(loadPennyMessages)
  const [pennyBusy, setPennyBusy] = useState(false)
  const [pennyError, setPennyError] = useState('')
  const chatAbortRef = useRef(null)
  const chatScrollRef = useRef(null)
  const [notice, setNotice] = useState('Penny has seized the administrator console.')

  const currentTitle = useMemo(
    () => navItems.find((item) => item.id === activeNav)?.label ?? 'FEED',
    [activeNav],
  )

  useEffect(() => {
    ownerTokenRef.current = getSocialOwnerToken()
    void loadAccount()
    void loadPersistentPosts(ownerTokenRef.current)
  }, [])

  useEffect(() => {
    if (pennyBusy) return
    try {
      window.sessionStorage.setItem(
        PENNY_SESSION_KEY,
        JSON.stringify(pennyMessages.slice(-20).map(({ id, role, text }) => ({ id, role, text }))),
      )
    } catch {
      // Session storage is optional. Penny still works without it.
    }
  }, [pennyBusy, pennyMessages])

  useEffect(() => {
    if (!pennyOpen || !chatScrollRef.current) return
    chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight
  }, [pennyMessages, pennyOpen])

  useEffect(() => () => {
    chatAbortRef.current?.abort()
  }, [])

  async function socialJson(response) {
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) {
      throw new Error(payload?.error || 'The social layer refused that request.')
    }
    return payload
  }

  async function loadAccount() {
    setAccountLoading(true)

    try {
      const response = await fetch('/api/auth/me')
      const payload = await socialJson(response)
      setAccount(payload.account || null)

      if (payload.account) {
        setAccountForm((current) => ({
          ...current,
          displayName: payload.account.displayName || '',
          handle: payload.account.handle || '',
          bio: payload.account.bio || '',
          password: '',
        }))
      }
    } catch {
      setAccount(null)
    } finally {
      setAccountLoading(false)
    }
  }

  function openAccountPanel(mode = account ? 'profile' : 'login') {
    setPennyOpen(false)
    setAccountError('')
    setAccountMode(mode)
    setAccountOpen(true)

    if (account) {
      setAccountForm({
        displayName: account.displayName || '',
        handle: account.handle || '',
        password: '',
        bio: account.bio || '',
      })
    }
  }

  function updateAccountField(field, value) {
    setAccountForm((current) => ({ ...current, [field]: value }))
  }

  async function submitAccount(event) {
    event.preventDefault()
    if (accountBusy) return

    setAccountBusy(true)
    setAccountError('')

    try {
      const endpoint = accountMode === 'register'
        ? '/api/auth/register'
        : accountMode === 'profile'
          ? '/api/auth/profile'
          : '/api/auth/login'

      const body = accountMode === 'profile'
        ? {
            displayName: accountForm.displayName,
            handle: accountForm.handle,
            bio: accountForm.bio,
            ownerToken: ownerTokenRef.current,
          }
        : accountMode === 'register'
          ? {
              displayName: accountForm.displayName,
              handle: accountForm.handle,
              password: accountForm.password,
              ownerToken: ownerTokenRef.current,
            }
          : {
              handle: accountForm.handle,
              password: accountForm.password,
              ownerToken: ownerTokenRef.current,
            }

      const response = await fetch(endpoint, {
        method: accountMode === 'profile' ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const payload = await socialJson(response)
      const nextAccount = payload.account

      setAccount(nextAccount)
      setAccountMode('profile')
      setAccountForm({
        displayName: nextAccount.displayName || '',
        handle: nextAccount.handle || '',
        password: '',
        bio: nextAccount.bio || '',
      })

      const claimedCount = (payload.claimed?.posts || 0) + (payload.claimed?.comments || 0)
      setNotice(
        claimedCount > 0
          ? `Identity locked. Claimed ${claimedCount} existing item${claimedCount === 1 ? '' : 's'}.`
          : accountMode === 'profile'
            ? 'Profile updated across your authored content.'
            : `Welcome, @${nextAccount.handle}. Identity online.`,
      )

      await loadPersistentPosts(ownerTokenRef.current)
    } catch (error) {
      setAccountError(error?.message || 'Identity request failed.')
    } finally {
      setAccountBusy(false)
    }
  }

  async function signOut() {
    if (accountBusy) return
    setAccountBusy(true)
    setAccountError('')

    try {
      const response = await fetch('/api/auth/logout', { method: 'POST' })
      await socialJson(response)
      setAccount(null)
      setAccountMode('login')
      setAccountForm({ displayName: '', handle: '', password: '', bio: '' })
      setNotice('Signed out. This browser still retains its local Stage 3A ownership token.')
      await loadPersistentPosts(ownerTokenRef.current)
    } catch (error) {
      setAccountError(error?.message || 'Sign out failed.')
    } finally {
      setAccountBusy(false)
    }
  }

  async function loadPersistentPosts(ownerToken = ownerTokenRef.current) {
    setFeedLoading(true)
    setFeedError('')

    try {
      const response = await fetch('/api/posts', {
        headers: ownerToken ? { 'X-WildCard-Owner': ownerToken } : {},
      })
      const payload = await socialJson(response)
      const persistent = (payload.posts || []).map(persistentPostFromApi)
      setPosts([...persistent, ...seedPosts])
      setNotice('Persistent feed online. Posts now survive refreshes.')
    } catch (error) {
      setFeedError(error?.message || 'Persistent feed unavailable.')
      setPosts(seedPosts)
    } finally {
      setFeedLoading(false)
    }
  }

  async function publishPost() {
    const text = draft.trim()
    if (!text || feedBusy) return

    const ownerToken = ownerTokenRef.current || getSocialOwnerToken()
    ownerTokenRef.current = ownerToken

    if (!ownerToken) {
      setNotice('This browser could not create a local ownership token.')
      return
    }

    setFeedBusy(true)
    setFeedError('')

    try {
      const response = await fetch('/api/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ownerToken, body: text }),
      })
      const payload = await socialJson(response)
      setPosts((current) => [persistentPostFromApi(payload.post), ...current])
      setDraft('')
      setNotice('Post persisted. Refresh away.')
    } catch (error) {
      setFeedError(error?.message || 'Post could not be saved.')
      setNotice('The post did not persist.')
    } finally {
      setFeedBusy(false)
    }
  }

  function startEditPost(post) {
    if (!post?.owned) return
    setEditingPostId(post.id)
    setEditDraft(post.text)
  }

  async function savePostEdit(postId) {
    const text = editDraft.trim()
    if (!text || feedBusy) return

    setFeedBusy(true)
    try {
      const response = await fetch('/api/posts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: postId,
          ownerToken: ownerTokenRef.current,
          body: text,
        }),
      })
      const payload = await socialJson(response)
      setPosts((current) => current.map((post) => (
        post.id === postId
          ? { ...post, text: payload.post.body, updatedAt: payload.post.updatedAt }
          : post
      )))
      setEditingPostId('')
      setEditDraft('')
      setNotice('Post updated.')
    } catch (error) {
      setNotice(error?.message || 'Post edit failed.')
    } finally {
      setFeedBusy(false)
    }
  }

  async function removePost(postId) {
    if (!window.confirm('Delete this post and its comments?')) return

    setFeedBusy(true)
    try {
      const response = await fetch('/api/posts', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: postId,
          ownerToken: ownerTokenRef.current,
        }),
      })
      await socialJson(response)
      setPosts((current) => current.filter((post) => post.id !== postId))
      setOpenComments((current) => {
        const next = new Set(current)
        next.delete(postId)
        return next
      })
      setNotice('Post deleted.')
    } catch (error) {
      setNotice(error?.message || 'Post deletion failed.')
    } finally {
      setFeedBusy(false)
    }
  }

  async function toggleComments(post) {
    if (!post.persisted) {
      setNotice('System-post comments stay pinned until account-backed social data arrives.')
      return
    }

    const opening = !openComments.has(post.id)

    setOpenComments((current) => {
      const next = new Set(current)
      opening ? next.add(post.id) : next.delete(post.id)
      return next
    })

    if (!opening || commentsByPost[post.id]) return

    setCommentBusy((current) => new Set(current).add(post.id))

    try {
      const response = await fetch(`/api/comments?postId=${encodeURIComponent(post.id)}`, {
        headers: ownerTokenRef.current
          ? { 'X-WildCard-Owner': ownerTokenRef.current }
          : {},
      })
      const payload = await socialJson(response)
      setCommentsByPost((current) => ({
        ...current,
        [post.id]: payload.comments || [],
      }))
    } catch (error) {
      setNotice(error?.message || 'Comments could not be loaded.')
    } finally {
      setCommentBusy((current) => {
        const next = new Set(current)
        next.delete(post.id)
        return next
      })
    }
  }

  async function submitComment(postId) {
    const text = (commentDrafts[postId] || '').trim()
    if (!text || commentBusy.has(postId)) return

    setCommentBusy((current) => new Set(current).add(postId))

    try {
      const response = await fetch('/api/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          postId,
          ownerToken: ownerTokenRef.current,
          body: text,
        }),
      })
      const payload = await socialJson(response)
      setCommentsByPost((current) => ({
        ...current,
        [postId]: [...(current[postId] || []), payload.comment],
      }))
      setCommentDrafts((current) => ({ ...current, [postId]: '' }))
      setPosts((current) => current.map((post) => (
        post.id === postId
          ? { ...post, comments: (post.comments || 0) + 1 }
          : post
      )))
      setNotice('Comment persisted.')
    } catch (error) {
      setNotice(error?.message || 'Comment could not be saved.')
    } finally {
      setCommentBusy((current) => {
        const next = new Set(current)
        next.delete(postId)
        return next
      })
    }
  }

  async function removeComment(postId, commentId) {
    try {
      const response = await fetch('/api/comments', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: commentId,
          ownerToken: ownerTokenRef.current,
        }),
      })
      await socialJson(response)
      setCommentsByPost((current) => ({
        ...current,
        [postId]: (current[postId] || []).filter((comment) => comment.id !== commentId),
      }))
      setPosts((current) => current.map((post) => (
        post.id === postId
          ? { ...post, comments: Math.max(0, (post.comments || 0) - 1) }
          : post
      )))
      setNotice('Comment deleted.')
    } catch (error) {
      setNotice(error?.message || 'Comment deletion failed.')
    }
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

  function clearPennySession() {
    if (pennyBusy) return
    setPennyMessages([])
    setPennyDraft('')
    setPennyError('')
    try {
      window.sessionStorage.removeItem(PENNY_SESSION_KEY)
    } catch {
      // Nothing else to clean up.
    }
  }

  async function sendPennyMessage(event) {
    event?.preventDefault()

    const text = pennyDraft.trim()
    if (!text || pennyBusy) return

    const stamp = Date.now()
    const userMessage = {
      id: `user-${stamp}`,
      role: 'user',
      text,
    }
    const assistantId = `penny-${stamp}`
    const outgoing = [...pennyMessages, userMessage]
      .slice(-10)
      .map((message) => ({ role: message.role, content: message.text }))

    setPennyDraft('')
    setPennyError('')
    setPennyBusy(true)
    setPennyMessages((current) => [
      ...current,
      userMessage,
      { id: assistantId, role: 'assistant', text: '', pending: true },
    ].slice(-20))

    const controller = new AbortController()
    chatAbortRef.current = controller

    try {
      const response = await fetch('/api/penny', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: outgoing }),
        signal: controller.signal,
      })

      if (!response.ok) {
        let message = 'Penny\'s line is unavailable right now.'
        try {
          const payload = await response.json()
          if (payload?.error) message = payload.error
        } catch {
          // Keep the friendly fallback above.
        }
        throw new Error(message)
      }

      if (!response.body) {
        throw new Error('Penny connected, but the reply stream never opened.')
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let receivedText = ''

      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value, { stream: true })
        if (!chunk) continue

        receivedText += chunk
        setPennyMessages((current) => current.map((message) => (
          message.id === assistantId
            ? { ...message, text: message.text + chunk }
            : message
        )))
      }

      if (!receivedText.trim()) {
        throw new Error('Penny answered with radio silence. Try that again.')
      }

      setPennyMessages((current) => current.map((message) => (
        message.id === assistantId
          ? { ...message, pending: false }
          : message
      )))
    } catch (error) {
      const interrupted = error?.name === 'AbortError'
      setPennyMessages((current) => current.map((message) => (
        message.id === assistantId
          ? {
              ...message,
              pending: false,
              text: message.text || (interrupted
                ? 'Transmission interrupted.'
                : 'I lost the line before I could answer.'),
            }
          : message
      )))
      if (!interrupted) {
        setPennyError(error?.message || 'Penny\'s line is unavailable right now.')
      }
    } finally {
      if (chatAbortRef.current === controller) {
        chatAbortRef.current = null
      }
      setPennyBusy(false)
    }
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
          <button
            className="account-action"
            type="button"
            onClick={() => openAccountPanel(account ? 'profile' : 'login')}
            aria-label={account ? 'Open profile' : 'Sign in'}
          >
            {accountLoading ? '…' : account ? account.displayName.slice(0, 1).toUpperCase() : 'SIGN IN'}
          </button>
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
            <h1>
              <span className="headline-desktop">Penny did the social network up in WildCard DEV aesthetics.</span>
              <span className="headline-mobile">Penny has the keys now.</span>
            </h1>
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
                <button
                  className="publish"
                  type="button"
                  onClick={publishPost}
                  disabled={feedBusy || !draft.trim()}
                >
                  {feedBusy ? 'SAVING…' : 'POST TO FEED'}
                </button>
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

            {activeNav === 'feed' && feedLoading && (
              <section className="panel feed-state">Opening the evidence locker…</section>
            )}

            {activeNav === 'feed' && feedError && (
              <section className="panel feed-state feed-state-error">{feedError}</section>
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
                  {post.persisted && post.owned ? (
                    <div className="post-owner-actions">
                      <button type="button" onClick={() => startEditPost(post)}>EDIT</button>
                      <button type="button" onClick={() => removePost(post.id)}>DELETE</button>
                    </div>
                  ) : (
                    <button type="button" aria-label="Post menu">•••</button>
                  )}
                </header>
                {editingPostId === post.id ? (
                  <div className="post-edit">
                    <textarea
                      value={editDraft}
                      onChange={(event) => setEditDraft(event.target.value)}
                      rows="4"
                      maxLength="2000"
                    />
                    <div>
                      <button type="button" onClick={() => {
                        setEditingPostId('')
                        setEditDraft('')
                      }}>
                        CANCEL
                      </button>
                      <button type="button" onClick={() => savePostEdit(post.id)}>
                        SAVE
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="post-copy">{post.text}</p>
                )}
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
                  <button type="button" onClick={() => toggleComments(post)}>☠ {post.comments} COMMENTS</button>
                  <button type="button" onClick={() => setNotice('Sharing arrives with real routes and identities.')}>↗ SHARE</button>
                </footer>

                {post.persisted && openComments.has(post.id) && (
                  <section className="comments-panel">
                    {commentBusy.has(post.id) && !commentsByPost[post.id] && (
                      <p className="comments-loading">Opening comments…</p>
                    )}

                    {(commentsByPost[post.id] || []).map((comment) => (
                      <div className="comment-row" key={comment.id}>
                        <span className="comment-avatar" aria-hidden="true">G</span>
                        <div>
                          <div className="comment-meta">
                            <strong>{comment.authorName}</strong>
                            <span>{comment.authorHandle} • {relativeTime(comment.createdAt)}</span>
                            {comment.owned && (
                              <button
                                type="button"
                                onClick={() => removeComment(post.id, comment.id)}
                              >
                                DELETE
                              </button>
                            )}
                          </div>
                          <p>{comment.body}</p>
                        </div>
                      </div>
                    ))}

                    <div className="comment-composer">
                      <input
                        value={commentDrafts[post.id] || ''}
                        onChange={(event) => setCommentDrafts((current) => ({
                          ...current,
                          [post.id]: event.target.value,
                        }))}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' && !event.shiftKey) {
                            event.preventDefault()
                            submitComment(post.id)
                          }
                        }}
                        placeholder="Leave evidence…"
                        maxLength="1000"
                      />
                      <button
                        type="button"
                        disabled={commentBusy.has(post.id) || !(commentDrafts[post.id] || '').trim()}
                        onClick={() => submitComment(post.id)}
                      >
                        POST
                      </button>
                    </div>
                  </section>
                )}
              </article>
            ))}
          </section>

          <aside className="right-rail">
            <section className="panel incident-board">
              <span className="panel-label">INCIDENTS</span>
              <div><b>01</b><p><strong>Penny acquired root.</strong><small>Administration changed hands.</small></p></div>
              <div><b>02</b><p><strong>Penny is live.</strong><small>Concierge AI answering in real time.</small></p></div>
              <div><b>03</b><p><strong>Persistence staged.</strong><small>Posts and comments ready for Postgres.</small></p></div>
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

      <button
        className={`penny-dock ${pennyOpen ? 'penny-dock-open' : ''}`}
        type="button"
        onClick={() => {
          setAccountOpen(false)
          setPennyOpen((open) => !open)
        }}
      >
        <span className="dock-sigil">♠</span>
        <span><b>ASK PENNY</b><small>CONCIERGE ONLINE</small></span>
        <i />
      </button>

      {accountOpen && (
        <section className="account-panel" aria-label="WildCard account">
          <header>
            <div>
              <span>{account ? account.displayName.slice(0, 1).toUpperCase() : '♠'}</span>
              <p>
                <strong>{account ? account.displayName : 'WILDCARD IDENTITY'}</strong>
                <small>{account ? `@${account.handle} // ACCOUNT ONLINE` : 'STAGE 3B // ACCOUNTS'}</small>
              </p>
            </div>
            <button type="button" onClick={() => setAccountOpen(false)} aria-label="Close account">×</button>
          </header>

          {!account && (
            <div className="account-tabs">
              <button
                type="button"
                className={accountMode === 'login' ? 'active' : ''}
                onClick={() => {
                  setAccountMode('login')
                  setAccountError('')
                }}
              >
                SIGN IN
              </button>
              <button
                type="button"
                className={accountMode === 'register' ? 'active' : ''}
                onClick={() => {
                  setAccountMode('register')
                  setAccountError('')
                }}
              >
                CREATE ACCOUNT
              </button>
            </div>
          )}

          <form className="account-form" onSubmit={submitAccount}>
            {(accountMode === 'register' || accountMode === 'profile') && (
              <label>
                <span>DISPLAY NAME</span>
                <input
                  value={accountForm.displayName}
                  onChange={(event) => updateAccountField('displayName', event.target.value)}
                  autoComplete="name"
                  maxLength="60"
                  required
                />
              </label>
            )}

            <label>
              <span>HANDLE</span>
              <div className="handle-input">
                <b>@</b>
                <input
                  value={accountForm.handle}
                  onChange={(event) => updateAccountField('handle', event.target.value.toLowerCase())}
                  autoComplete="username"
                  maxLength="24"
                  pattern="[a-z0-9_]{3,24}"
                  required
                />
              </div>
            </label>

            {accountMode !== 'profile' && (
              <label>
                <span>PASSWORD</span>
                <input
                  type="password"
                  value={accountForm.password}
                  onChange={(event) => updateAccountField('password', event.target.value)}
                  autoComplete={accountMode === 'register' ? 'new-password' : 'current-password'}
                  minLength="10"
                  maxLength="128"
                  required
                />
                {accountMode === 'register' && <small>10+ characters. No phone number required.</small>}
              </label>
            )}

            {accountMode === 'profile' && (
              <label>
                <span>BIO</span>
                <textarea
                  value={accountForm.bio}
                  onChange={(event) => updateAccountField('bio', event.target.value)}
                  rows="3"
                  maxLength="280"
                  placeholder="A little evidence for the file…"
                />
              </label>
            )}

            {accountError && <div className="account-error" role="alert">{accountError}</div>}

            <button className="account-primary" type="submit" disabled={accountBusy}>
              {accountBusy
                ? 'WORKING…'
                : accountMode === 'register'
                  ? 'CREATE IDENTITY'
                  : accountMode === 'profile'
                    ? 'SAVE PROFILE'
                    : 'SIGN IN'}
            </button>
          </form>

          {account && (
            <footer className="account-footer">
              <div>
                <strong>@{account.handle}</strong>
                <span>{account.bio || 'Profile online. Bio optional.'}</span>
              </div>
              <button type="button" onClick={signOut} disabled={accountBusy}>SIGN OUT</button>
            </footer>
          )}
        </section>
      )}

      {pennyOpen && (
        <section className="penny-panel" aria-label="Ask Penny">
          <header>
            <div>
              <span>♠</span>
              <p><strong>PENNY</strong><small>WILDCARD CONCIERGE // LIVE</small></p>
            </div>
            <div className="penny-header-actions">
              <button
                className="penny-clear"
                type="button"
                onClick={clearPennySession}
                disabled={pennyBusy || pennyMessages.length === 0}
              >
                CLEAR
              </button>
              <button type="button" onClick={() => setPennyOpen(false)} aria-label="Close Penny">×</button>
            </div>
          </header>

          <div className="penny-transcript" ref={chatScrollRef} aria-live="polite">
            {pennyMessages.length === 0 && (
              <div className="penny-message assistant">
                <span>ROOT // PENNY</span>
                <p>Door's open. What do you need?</p>
              </div>
            )}

            {pennyMessages.map((message) => (
              <div
                className={`penny-message ${message.role === 'user' ? 'user' : 'assistant'}`}
                key={message.id}
              >
                <span>{message.role === 'user' ? 'YOU // LOCAL SESSION' : 'ROOT // PENNY'}</span>
                <p>
                  {message.text}
                  {message.pending && <i className="typing-cursor" aria-hidden="true" />}
                </p>
              </div>
            ))}

            {pennyError && (
              <div className="penny-error" role="alert">{pennyError}</div>
            )}
          </div>

          <form className="penny-input" onSubmit={sendPennyMessage}>
            <textarea
              value={pennyDraft}
              onChange={(event) => setPennyDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  sendPennyMessage(event)
                }
              }}
              disabled={pennyBusy}
              placeholder={pennyBusy ? 'Penny is answering…' : 'Ask Penny anything…'}
              rows="1"
              maxLength="2000"
              aria-label="Message Penny"
            />
            <button
              type="submit"
              disabled={pennyBusy || !pennyDraft.trim()}
            >
              {pennyBusy ? 'LIVE' : 'SEND'}
            </button>
          </form>
        </section>
      )}

      <footer className="site-footer">
        <span>♠ WILDCARD PARTY</span>
        <p>Stage 3B identities • Persistent ownership online</p>
        <a href="https://www.wildcarddev.com" target="_blank" rel="noopener noreferrer">WILDCARD DEV</a>
      </footer>
    </div>
  )
}

export default App
