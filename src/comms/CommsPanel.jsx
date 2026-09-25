import { useEffect, useRef, useState } from 'react'
import './comms.css'

function dedupeMessages(items) {
  const seen = new Set()
  return items.filter((message) => {
    if (!message?.id || seen.has(message.id)) return false
    seen.add(message.id)
    return true
  })
}

function previewText(message) {
  if (!message?.body) return 'No messages yet.'
  return message.body.replace(/\s+/g, ' ').trim()
}

function initials(account) {
  const source = account?.displayName || account?.handle || '?'
  return source.trim().slice(0, 2).toUpperCase()
}

function numericUnreadCount(value) {
  const count = Number(value)
  return Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0
}

function displayUnreadCount(value) {
  const count = numericUnreadCount(value)
  return count > 99 ? '99+' : String(count)
}

function compareMessageOrder(left, right) {
  const leftCreatedAt = String(left?.createdAt || '')
  const rightCreatedAt = String(right?.createdAt || '')

  if (leftCreatedAt !== rightCreatedAt) {
    return leftCreatedAt > rightCreatedAt ? 1 : -1
  }

  const leftId = String(left?.id || left?.messageId || '').toLowerCase()
  const rightId = String(right?.id || right?.messageId || '').toLowerCase()

  if (leftId === rightId) return 0
  return leftId > rightId ? 1 : -1
}

export default function CommsPanel({
  account,
  accountLoading = false,
  onRequireSignIn,
  onUnreadCountChange,
}) {
  const [conversations, setConversations] = useState([])
  const [selectedConversation, setSelectedConversation] = useState(null)
  const [messages, setMessages] = useState([])
  const [hasOlder, setHasOlder] = useState(false)
  const [mobilePane, setMobilePane] = useState('list')
  const [conversationBusy, setConversationBusy] = useState(false)
  const [historyBusy, setHistoryBusy] = useState(false)
  const [sendBusy, setSendBusy] = useState(false)
  const [error, setError] = useState('')
  const [draft, setDraft] = useState('')
  const [search, setSearch] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [searchBusy, setSearchBusy] = useState(false)
  const [otherReadThrough, setOtherReadThrough] = useState(null)

  const messageViewportRef = useRef(null)
  const historyControllerRef = useRef(null)
  const allControllersRef = useRef(new Set())
  const pollControllersRef = useRef(new Set())
  const messagesRef = useRef([])
  const shouldScrollRef = useRef(false)
  const pendingSendIdsRef = useRef(new Map())
  const selectedConversationRef = useRef(null)
  const mobilePaneRef = useRef('list')
  const readMarkedRef = useRef(new Map())
  const readInFlightRef = useRef(false)
  const pendingReadRef = useRef(null)

  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

  useEffect(() => {
    selectedConversationRef.current = selectedConversation
  }, [selectedConversation])

  useEffect(() => {
    mobilePaneRef.current = mobilePane
  }, [mobilePane])

  useEffect(() => () => {
    historyControllerRef.current?.abort()
    for (const controller of allControllersRef.current) controller.abort()
    allControllersRef.current.clear()
    pollControllersRef.current.clear()
  }, [])

  useEffect(() => {
    setConversations([])
    setSelectedConversation(null)
    setMessages([])
    setHasOlder(false)
    setMobilePane('list')
    setOtherReadThrough(null)
    setError('')
    selectedConversationRef.current = null
    mobilePaneRef.current = 'list'
    pendingSendIdsRef.current.clear()
    readMarkedRef.current.clear()
    pendingReadRef.current = null
    onUnreadCountChange?.(0)
  }, [account?.id])

  useEffect(() => {
    if (!shouldScrollRef.current || !messageViewportRef.current) return
    shouldScrollRef.current = false
    messageViewportRef.current.scrollTop = messageViewportRef.current.scrollHeight
  }, [messages])

  async function requestJson(url, options = {}, suppliedController = null) {
    const controller = suppliedController || new AbortController()
    allControllersRef.current.add(controller)

    try {
      const response = await fetch(url, {
        ...options,
        cache: 'no-store',
        signal: controller.signal,
      })
      const payload = await response.json().catch(() => ({}))

      if (!response.ok) {
        const requestError = new Error(payload?.error || 'COMMS request failed.')
        requestError.status = response.status
        throw requestError
      }

      return payload
    } finally {
      allControllersRef.current.delete(controller)
      pollControllersRef.current.delete(controller)
    }
  }

  async function loadConversations({ quiet = false, controller = null } = {}) {
    if (!account?.id) return []

    if (!quiet) setConversationBusy(true)

    try {
      const payload = await requestJson('/api/comms/conversations', {}, controller)
      const next = Array.isArray(payload.conversations) ? payload.conversations : []
      setConversations(next)
      onUnreadCountChange?.(
        next.reduce((sum, conversation) => sum + numericUnreadCount(conversation.unreadCount), 0),
      )
      setSelectedConversation((current) => {
        if (!current) return current
        return next.find((conversation) => conversation.id === current.id) || current
      })
      return next
    } catch (requestError) {
      if (requestError?.name !== 'AbortError' && !quiet) {
        setError(requestError?.message || 'Conversations could not be loaded.')
      }
      return []
    } finally {
      if (!quiet) setConversationBusy(false)
    }
  }

  async function flushReadQueue() {
    if (readInFlightRef.current || !pendingReadRef.current) return

    const target = pendingReadRef.current
    pendingReadRef.current = null
    readInFlightRef.current = true

    try {
      const payload = await requestJson('/api/comms/read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: target.conversationId,
          messageId: target.message.id,
        }),
      })

      if (payload.readState?.messageId) {
        const existing = readMarkedRef.current.get(target.conversationId)
        if (!existing || compareMessageOrder(payload.readState, existing) > 0) {
          readMarkedRef.current.set(target.conversationId, payload.readState)
        }

        setConversations((current) => current.map((conversation) => (
          conversation.id === target.conversationId
            ? { ...conversation, unreadCount: 0 }
            : conversation
        )))
      }

      if (Number.isFinite(Number(payload.unreadCount))) {
        onUnreadCountChange?.(numericUnreadCount(payload.unreadCount))
      }
    } catch (requestError) {
      if (requestError?.name !== 'AbortError') {
        console.error('COMMS read sync failed', requestError)
      }
    } finally {
      readInFlightRef.current = false
      if (pendingReadRef.current) {
        flushReadQueue()
      }
    }
  }

  function queueConversationRead(conversationId, message) {
    if (
      document.hidden ||
      !conversationId ||
      !message?.id ||
      !message?.createdAt ||
      selectedConversationRef.current?.id !== conversationId ||
      mobilePaneRef.current !== 'chat'
    ) {
      return
    }

    const targetMessage = {
      id: message.id,
      createdAt: message.createdAt,
    }
    const marked = readMarkedRef.current.get(conversationId)

    if (marked && compareMessageOrder(marked, targetMessage) >= 0) return

    const pending = pendingReadRef.current
    if (
      pending?.conversationId === conversationId &&
      compareMessageOrder(pending.message, targetMessage) >= 0
    ) {
      return
    }

    pendingReadRef.current = {
      conversationId,
      message: targetMessage,
    }

    flushReadQueue()
  }

  async function pollMessages(conversationId, controller = null) {
    if (!account?.id || !conversationId) return

    const current = messagesRef.current
    const lastMessage = current[current.length - 1]
    const suffix = lastMessage?.id
      ? `&after=${encodeURIComponent(lastMessage.id)}`
      : ''

    try {
      const payload = await requestJson(
        `/api/comms/messages?conversationId=${encodeURIComponent(conversationId)}${suffix}`,
        {},
        controller,
      )
      setOtherReadThrough(payload.otherReadThrough || null)

      const incoming = Array.isArray(payload.messages) ? payload.messages : []
      if (!incoming.length) return

      shouldScrollRef.current = true
      setMessages((existing) => dedupeMessages([...existing, ...incoming]))

      if (!document.hidden) {
        queueConversationRead(conversationId, incoming[incoming.length - 1])
      }
    } catch (requestError) {
      if (requestError?.name !== 'AbortError') {
        setError(requestError?.message || 'New messages could not be checked.')
      }
    }
  }

  useEffect(() => {
    if (!account?.id) return undefined

    let conversationTimer = null
    let messageTimer = null
    let conversationController = null
    let messageController = null

    const clearTimers = () => {
      if (conversationTimer) window.clearInterval(conversationTimer)
      if (messageTimer) window.clearInterval(messageTimer)
      conversationTimer = null
      messageTimer = null

      conversationController?.abort()
      messageController?.abort()
      conversationController = null
      messageController = null
    }

    const pollConversationList = async () => {
      if (document.hidden || conversationController) return

      const controller = new AbortController()
      conversationController = controller
      pollControllersRef.current.add(controller)

      try {
        await loadConversations({ quiet: true, controller })
      } finally {
        if (conversationController === controller) {
          conversationController = null
        }
      }
    }

    const pollActiveConversation = async () => {
      if (document.hidden || !selectedConversation?.id || messageController) return

      const controller = new AbortController()
      messageController = controller
      pollControllersRef.current.add(controller)

      try {
        await pollMessages(selectedConversation.id, controller)
      } finally {
        if (messageController === controller) {
          messageController = null
        }
      }
    }

    const startTimers = ({ refreshMessages = false } = {}) => {
      if (document.hidden) return

      pollConversationList()
      if (refreshMessages) pollActiveConversation()

      conversationTimer = window.setInterval(pollConversationList, 12000)
      if (selectedConversation?.id) {
        messageTimer = window.setInterval(pollActiveConversation, 4000)
      }
    }

    const restartTimers = () => {
      clearTimers()
      if (!document.hidden) {
        startTimers({ refreshMessages: true })
      }
    }

    const handleVisibility = () => {
      restartTimers()
    }

    const handleRecovery = () => {
      if (!document.hidden) {
        restartTimers()
      }
    }

    startTimers()
    document.addEventListener('visibilitychange', handleVisibility)
    window.addEventListener('focus', handleRecovery)
    window.addEventListener('pageshow', handleRecovery)
    window.addEventListener('online', handleRecovery)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility)
      window.removeEventListener('focus', handleRecovery)
      window.removeEventListener('pageshow', handleRecovery)
      window.removeEventListener('online', handleRecovery)
      clearTimers()
    }
  }, [account?.id, selectedConversation?.id])

  async function selectConversation(conversation) {
    if (!conversation?.id) return

    historyControllerRef.current?.abort()
    const controller = new AbortController()
    historyControllerRef.current = controller

    setSelectedConversation(conversation)
    selectedConversationRef.current = conversation
    setMobilePane('chat')
    mobilePaneRef.current = 'chat'
    setMessages([])
    setOtherReadThrough(null)
    setHasOlder(false)
    setHistoryBusy(true)
    setError('')
    shouldScrollRef.current = true

    try {
      const payload = await requestJson(
        `/api/comms/messages?conversationId=${encodeURIComponent(conversation.id)}`,
        {},
        controller,
      )
      const initialMessages = dedupeMessages(
        Array.isArray(payload.messages) ? payload.messages : [],
      )
      setMessages(initialMessages)
      setOtherReadThrough(payload.otherReadThrough || null)
      setHasOlder(initialMessages.length === 50)

      const newestMessage = initialMessages[initialMessages.length - 1]
      if (newestMessage && !document.hidden) {
        queueConversationRead(conversation.id, newestMessage)
      }
    } catch (requestError) {
      if (requestError?.name !== 'AbortError') {
        setError(requestError?.message || 'Message history could not be loaded.')
      }
    } finally {
      if (historyControllerRef.current === controller) {
        historyControllerRef.current = null
        setHistoryBusy(false)
      }
    }
  }

  async function loadEarlier() {
    const conversationId = selectedConversation?.id
    const firstMessage = messagesRef.current[0]
    if (!conversationId || !firstMessage?.id || historyBusy) return

    setHistoryBusy(true)
    setError('')
    const viewport = messageViewportRef.current
    const previousHeight = viewport?.scrollHeight || 0

    try {
      const payload = await requestJson(
        `/api/comms/messages?conversationId=${encodeURIComponent(conversationId)}&before=${encodeURIComponent(firstMessage.id)}`,
      )
      const older = Array.isArray(payload.messages) ? payload.messages : []
      setOtherReadThrough(payload.otherReadThrough || null)

      setMessages((current) => dedupeMessages([...older, ...current]))
      setHasOlder(older.length === 50)

      if (viewport && older.length) {
        window.requestAnimationFrame(() => {
          const addedHeight = viewport.scrollHeight - previousHeight
          viewport.scrollTop += addedHeight
        })
      }
    } catch (requestError) {
      if (requestError?.name !== 'AbortError') {
        setError(requestError?.message || 'Earlier messages could not be loaded.')
      }
    } finally {
      setHistoryBusy(false)
    }
  }

  async function discoverAccounts(event) {
    event?.preventDefault()
    const query = search.trim()

    if (query.length < 2) {
      setSearchResults([])
      setError('Enter at least 2 characters to find another account.')
      return
    }

    setSearchBusy(true)
    setError('')

    try {
      const payload = await requestJson(
        `/api/comms/accounts?q=${encodeURIComponent(query)}`,
      )
      setSearchResults(Array.isArray(payload.accounts) ? payload.accounts : [])
    } catch (requestError) {
      if (requestError?.name !== 'AbortError') {
        setError(requestError?.message || 'Account search failed.')
      }
    } finally {
      setSearchBusy(false)
    }
  }

  async function openConversation(accountResult) {
    if (!accountResult?.id) return

    setConversationBusy(true)
    setError('')

    try {
      const payload = await requestJson('/api/comms/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: accountResult.id }),
      })
      const conversation = payload.conversation

      if (!conversation?.id) {
        throw new Error('The conversation did not return a canonical ID.')
      }

      setConversations((current) => [
        conversation,
        ...current.filter((item) => item.id !== conversation.id),
      ])
      setSearch('')
      setSearchResults([])
      await selectConversation(conversation)
    } catch (requestError) {
      if (requestError?.name !== 'AbortError') {
        setError(requestError?.message || 'Conversation could not be opened.')
      }
    } finally {
      setConversationBusy(false)
    }
  }

  async function sendMessage() {
    const conversationId = selectedConversation?.id
    const body = draft.trim()
    if (!conversationId || !body || sendBusy) return

    const messageLength = Array.from(body).length
    if (messageLength > 4000) {
      setError('Messages are limited to 4000 characters.')
      return
    }

    const pendingKey = `${conversationId}\u0000${body}`
    const clientMessageId = pendingSendIdsRef.current.get(pendingKey) || crypto.randomUUID()
    pendingSendIdsRef.current.set(pendingKey, clientMessageId)

    setSendBusy(true)
    setError('')

    try {
      const payload = await requestJson('/api/comms/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId,
          clientMessageId,
          body,
        }),
      })

      if (!payload.message?.id) {
        throw new Error('The server did not return the saved message.')
      }

      pendingSendIdsRef.current.delete(pendingKey)
      shouldScrollRef.current = true
      setMessages((current) => dedupeMessages([...current, payload.message]))
      setDraft('')

      if (!document.hidden) {
        queueConversationRead(conversationId, payload.message)
      }

      await loadConversations({ quiet: true })
    } catch (requestError) {
      if (
        requestError?.name !== 'AbortError' &&
        Number.isInteger(requestError?.status) &&
        requestError.status < 500
      ) {
        pendingSendIdsRef.current.delete(pendingKey)
      }

      if (requestError?.name !== 'AbortError') {
        const ambiguous = !requestError?.status || requestError.status >= 500
        setError(
          ambiguous
            ? 'Send status is uncertain. Retry the same text to reuse its message ID safely.'
            : requestError?.message || 'Message could not be sent.',
        )
      }
    } finally {
      setSendBusy(false)
    }
  }

  function handleComposerKeyDown(event) {
    if (event.key !== 'Enter' || event.shiftKey) return
    event.preventDefault()
    sendMessage()
  }

  const newestOutgoingMessage = [...messages]
    .reverse()
    .find((message) => message.senderAccountId === account?.id)
  const newestOutgoingRead = Boolean(
    newestOutgoingMessage &&
    otherReadThrough &&
    compareMessageOrder(otherReadThrough, newestOutgoingMessage) >= 0
  )

  if (accountLoading) {
    return (
      <section className="panel comms-panel comms-auth-state" aria-label="COMMS">
        <span className="comms-kicker">COMMS // ACCOUNT CHECK</span>
        <h2>Checking secure identity…</h2>
      </section>
    )
  }

  if (!account) {
    return (
      <section className="panel comms-panel comms-auth-state" aria-label="COMMS">
        <span className="comms-kicker">COMMS // SIGN-IN REQUIRED</span>
        <h2>Direct messages require a WildCard account.</h2>
        <p>COMMS uses the existing account session. No phone number or second identity is required.</p>
        <button type="button" onClick={() => onRequireSignIn?.()}>
          OPEN SIGN IN
        </button>
      </section>
    )
  }

  return (
    <section
      className={`panel comms-panel comms-pane-${mobilePane}`}
      aria-label="Direct messages"
    >
      <header className="comms-header">
        <div>
          <span className="comms-kicker">STAGE 4A // TEXT DIRECT MESSAGES</span>
          <h2>COMMS</h2>
        </div>
        <span className="comms-identity">
          {account.displayName} <b>@{account.handle}</b>
        </span>
      </header>

      {error && (
        <div className="comms-error" role="alert">
          {error}
          <button type="button" onClick={() => setError('')} aria-label="Dismiss COMMS error">×</button>
        </div>
      )}

      <div className="comms-shell">
        <aside className="comms-sidebar" aria-label="Conversations and account discovery">
          <form className="comms-search" onSubmit={discoverAccounts}>
            <label htmlFor="comms-account-search">FIND ACCOUNT</label>
            <div>
              <input
                id="comms-account-search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Handle or display name"
                autoComplete="off"
              />
              <button type="submit" disabled={searchBusy || search.trim().length < 2}>
                {searchBusy ? '…' : 'SEARCH'}
              </button>
            </div>
          </form>

          {searchResults.length > 0 && (
            <div className="comms-search-results" aria-label="Account search results">
              {searchResults.map((result) => (
                <button
                  type="button"
                  key={result.id}
                  onClick={() => openConversation(result)}
                  disabled={conversationBusy}
                >
                  <span className="comms-sigil" aria-hidden="true">{initials(result)}</span>
                  <span>
                    <strong>{result.displayName}</strong>
                    <small>@{result.handle}</small>
                  </span>
                  <b>MESSAGE</b>
                </button>
              ))}
            </div>
          )}

          <div className="comms-list-heading">
            <span>CONVERSATIONS</span>
            {conversationBusy && <small>SYNCING…</small>}
          </div>

          <div className="comms-conversation-list">
            {!conversationBusy && conversations.length === 0 && (
              <p className="comms-empty">No conversations yet. Find an account above to open one.</p>
            )}

            {conversations.map((conversation) => (
              <button
                type="button"
                key={conversation.id}
                className={selectedConversation?.id === conversation.id ? 'active' : ''}
                onClick={() => selectConversation(conversation)}
              >
                <span className="comms-sigil" aria-hidden="true">
                  {initials(conversation.otherAccount)}
                </span>
                <span className="comms-conversation-copy">
                  <strong>{conversation.otherAccount?.displayName || 'WildCard Account'}</strong>
                  <small>@{conversation.otherAccount?.handle || 'unknown'}</small>
                  <em>{previewText(conversation.latestMessage)}</em>
                </span>
                {numericUnreadCount(conversation.unreadCount) > 0 && (
                  <span
                    className="comms-unread-badge"
                    aria-label={`${numericUnreadCount(conversation.unreadCount)} unread messages`}
                  >
                    {displayUnreadCount(conversation.unreadCount)}
                  </span>
                )}
              </button>
            ))}
          </div>
        </aside>

        <section className="comms-chat" aria-label="Selected conversation">
          {selectedConversation ? (
            <>
              <header className="comms-chat-header">
                <button
                  className="comms-back"
                  type="button"
                  onClick={() => {
                    setMobilePane('list')
                    mobilePaneRef.current = 'list'
                  }}
                >
                  ← BACK
                </button>
                <span className="comms-sigil" aria-hidden="true">
                  {initials(selectedConversation.otherAccount)}
                </span>
                <div>
                  <strong>{selectedConversation.otherAccount?.displayName}</strong>
                  <small>@{selectedConversation.otherAccount?.handle}</small>
                </div>
              </header>

              <div className="comms-history-tools">
                {hasOlder ? (
                  <button type="button" onClick={loadEarlier} disabled={historyBusy}>
                    {historyBusy ? 'LOADING…' : 'LOAD EARLIER'}
                  </button>
                ) : (
                  <span>START OF LOADED HISTORY</span>
                )}
              </div>

              <div className="comms-messages" ref={messageViewportRef}>
                {historyBusy && messages.length === 0 && (
                  <p className="comms-empty">Loading message history…</p>
                )}

                {!historyBusy && messages.length === 0 && (
                  <p className="comms-empty">No messages yet. Open the line.</p>
                )}

                {messages.map((message) => {
                  const outgoing = message.senderAccountId === account.id
                  return (
                    <article
                      key={message.id}
                      className={`comms-message ${outgoing ? 'outgoing' : 'incoming'}`}
                    >
                      <span>{outgoing ? 'YOU' : 'INCOMING'}</span>
                      <p>{message.body}</p>
                      {outgoing && newestOutgoingRead && message.id === newestOutgoingMessage?.id && (
                        <small className="comms-read-receipt">READ</small>
                      )}
                    </article>
                  )
                })}
              </div>

              <div className="comms-composer">
                <label htmlFor="comms-message-draft">MESSAGE</label>
                <textarea
                  id="comms-message-draft"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={handleComposerKeyDown}
                  placeholder={`Message @${selectedConversation.otherAccount?.handle || 'account'}`}
                  rows="3"
                />
                <div>
                  <small>ENTER sends • SHIFT+ENTER adds a line</small>
                  <button
                    type="button"
                    onClick={sendMessage}
                    disabled={sendBusy || !draft.trim()}
                  >
                    {sendBusy ? 'SENDING…' : 'SEND'}
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="comms-no-selection">
              <span aria-hidden="true">✉</span>
              <h3>Select a conversation.</h3>
              <p>Choose an existing line or find another WildCard account.</p>
            </div>
          )}
        </section>
      </div>
    </section>
  )
}
