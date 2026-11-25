import { POLL, nextUnreadDelay, bridgeStateChanged } from './poll-policy.js'
import { BRIDGE, parentOrigin, validParentEvent, unreadCount } from './messenger-bridge.js'

const origin = parentOrigin(new URLSearchParams(location.search).get('parent'))
const rootNode = document.getElementById('root')
if (!origin || window.parent === window) {
  const link = document.createElement('a')
  link.href = '/?app=messenger'
  link.textContent = 'Open WildCard Messenger'
  rootNode.append(link)
} else {
  const post = (kind, data = {}) => window.parent.postMessage({ type: BRIDGE + kind, ...data }, origin)
  let state = { open: false, visible: false }
  let timer = null
  let controller = null
  let root = null
  let mount = null
  let generation = 0
  let stopped = false
  let delay = POLL.unread
  const stopPoll = () => {
    if (timer !== null) clearTimeout(timer)
    timer = null
    controller?.abort()
    controller = null
  }
  const status = (count, signedIn) => {
    if (!stopped) post('unread', { count, signedIn })
  }
  const refresh = async () => {
    if (stopped || state.open || !state.visible || document.hidden || controller) return
    const request = new AbortController()
    controller = request
    try {
      const response = await fetch('/api/comms/unread', {
        credentials: 'same-origin', cache: 'no-store', signal: request.signal,
      })
      if (request.signal.aborted) return
      delay = nextUnreadDelay(delay, response.status)
      if (response.status === 401) { status(0, false); return }
      if (!response.ok) return
      const count = unreadCount((await response.json()).unreadCount)
      if (!request.signal.aborted && count !== null) { status(count, true) }
    } catch { if (!request.signal.aborted) delay = nextUnreadDelay(delay, 0) }
    finally {
      if (controller === request) {
        controller = null
        if (!stopped && !state.open && state.visible && !document.hidden) timer = setTimeout(refresh, delay)
      }
    }
  }
  const syncPoll = () => {
    stopPoll()
    if (stopped || state.open || !state.visible || document.hidden) return
    refresh()
  }
  const syncView = async () => {
    const id = ++generation
    if (!state.open) {
      root?.render(null)
      syncPoll()
      return
    }
    stopPoll()
    try {
      mount ||= import('./messenger-embed-view.jsx')
      const { createMessengerRoot } = await mount
      if (stopped || id !== generation || !state.open) return
      root ||= createMessengerRoot(rootNode)
      root.show((count, signedIn) => {
        if (state.open && id === generation) status(count, signedIn)
      })
      post('opened')
    } catch {
      mount = null
      if (id === generation && state.open) post('error')
    }
  }
  window.addEventListener('message', event => {
    if (!validParentEvent(event, origin, window.parent) || stopped) return
    const next = { open: event.data.open, visible: event.data.visible }
    if (!bridgeStateChanged(state, next)) return
    const changed = state.open !== next.open
    state = next
    if (changed) syncView()
    else if (!state.open) syncPoll()
  })
  document.addEventListener('visibilitychange', () => { if (!state.open) syncPoll() })
  window.addEventListener('online', () => { if (!state.open) syncPoll() })
  window.addEventListener('keydown', event => {
    if (event.key === 'Escape' && state.open) post('close')
  })
  window.addEventListener('pagehide', event => {
    stopPoll()
    if (!event.persisted) { stopped = true; generation++; root?.unmount() }
  })
  window.addEventListener('pageshow', () => { if (!stopped) post('ready') })
  post('ready')
}
