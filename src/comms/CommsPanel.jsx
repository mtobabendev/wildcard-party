import { Fragment, useEffect, useRef, useState } from 'react'
import './comms.css'

const MAX_ATTACHMENT_BYTES = 10485760
const ALLOWED_ATTACHMENT_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/json',
  'application/zip',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
])
const ATTACHMENT_ACCEPT = [
  ...ALLOWED_ATTACHMENT_TYPES,
  'audio/*',
  'video/*',
].join(',')

function normalizedAttachmentType(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

function isAllowedAttachmentType(value) {
  const type = normalizedAttachmentType(value)
  return (
    ALLOWED_ATTACHMENT_TYPES.has(type) ||
    type.startsWith('audio/') ||
    type.startsWith('video/')
  )
}

const mediaPlaybackSupport = new Map()

function canPlayAttachmentMedia(attachment) {
  const contentType = normalizedAttachmentType(attachment?.contentType)
  const mediaKind = attachment?.isAudio
    ? 'audio'
    : attachment?.isVideo
      ? 'video'
      : ''

  if (!contentType || !mediaKind || typeof document === 'undefined') return false

  const cacheKey = `${mediaKind}:${contentType}`
  if (mediaPlaybackSupport.has(cacheKey)) {
    return mediaPlaybackSupport.get(cacheKey)
  }

  const media = document.createElement(mediaKind)
  const supported = Boolean(media.canPlayType(contentType))
  mediaPlaybackSupport.set(cacheKey, supported)
  return supported
}

function safeAttachmentName(value) {
  const source = typeof value === 'string' ? value : ''
  const basename = source.split(/[\\/]/).pop() || ''
  const cleaned = basename
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180)

  return cleaned || 'attachment'
}

function readableBytes(value) {
  const bytes = Number(value)
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(bytes >= 10240 ? 0 : 1)} KB`
  return `${(bytes / 1048576).toFixed(bytes >= 10485760 ? 0 : 1)} MB`
}

function dedupeMessages(items) {
  const seen = new Set()
  return items.filter((message) => {
    if (!message?.id || seen.has(message.id)) return false
    seen.add(message.id)
    return true
  })
}

function previewText(message) {
  const body = message?.body?.replace(/\s+/g, ' ').trim()
  if (body) return body
  if (message?.attachment?.name) return `📎 ${message.attachment.name}`
  return 'No messages yet.'
}

function initials(account) {
  const source = account?.displayName || account?.handle || '?'
  return source.trim().slice(0, 2).toUpperCase()
}

function presenceText(presence) {
  if (presence?.isOnline === true) return 'ONLINE'

  const stamp = new Date(presence?.lastActiveAt || '').getTime()
  if (!Number.isFinite(stamp)) return 'OFFLINE'

  const minutes = Math.max(0, Math.floor((Date.now() - stamp) / 60000))
  if (minutes < 1) return 'ACTIVE <1M AGO'
  if (minutes < 60) return `ACTIVE ${minutes}M AGO`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `ACTIVE ${hours}H AGO`

  const days = Math.floor(hours / 24)
  return `ACTIVE ${days}D AGO`
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

const ACTIVE_CALL_STATUSES = new Set(['ringing', 'accepted'])
const TERMINAL_CALL_STATUSES = new Set(['declined', 'cancelled', 'ended', 'missed'])

function isActiveCall(call) {
  return Boolean(call?.id && ACTIVE_CALL_STATUSES.has(call.status))
}

function isTerminalCall(call) {
  return Boolean(call?.id && TERMINAL_CALL_STATUSES.has(call.status))
}

function callKindLabel(call) {
  return call?.kind === 'video' ? 'VIDEO' : 'AUDIO'
}

function terminalCallLabel(call) {
  if (call?.status === 'declined') return 'CALL DECLINED'
  if (call?.status === 'cancelled') return 'CALL CANCELLED'
  if (call?.status === 'ended') return 'CALL ENDED'
  if (call?.status === 'missed') return 'CALL MISSED'
  return 'CALL CLOSED'
}

function mediaStateLabel(call, state) {
  if (state === 'preparing') return 'PREPARING MEDIA'
  if (state === 'waiting-offer') return 'CONNECTING MEDIA'
  if (state === 'connecting') {
    return call?.kind === 'video' ? 'CONNECTING VIDEO' : 'CONNECTING AUDIO'
  }
  if (state === 'live') {
    return call?.kind === 'video' ? 'VIDEO LIVE' : 'AUDIO LIVE'
  }
  if (state === 'interrupted') return 'MEDIA CONNECTION INTERRUPTED'
  if (state === 'failed') return 'MEDIA CONNECTION FAILED'
  if (state === 'redial') return 'MEDIA SESSION NEEDS REDIAL'
  return 'SIGNALING READY'
}

function sleep(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds))
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
  const [attachmentFile, setAttachmentFile] = useState(null)
  const [sendStage, setSendStage] = useState('')
  const [currentCall, setCurrentCall] = useState(null)
  const [callBusy, setCallBusy] = useState(false)
  const [callError, setCallError] = useState('')
  const [mediaState, setMediaState] = useState('idle')
  const [mediaError, setMediaError] = useState('')
  const [mediaMuted, setMediaMuted] = useState(false)
  const [cameraEnabled, setCameraEnabled] = useState(true)
  const [autoplayBlocked, setAutoplayBlocked] = useState(false)
  const [mediaRevision, setMediaRevision] = useState(0)
  const [signalPollingReady, setSignalPollingReady] = useState(false)
  const [mediaRetryNonce, setMediaRetryNonce] = useState(0)

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
  const attachmentInputRef = useRef(null)
  const currentCallRef = useRef(null)
  const pendingCallIdsRef = useRef(new Map())
  const terminalCallTimerRef = useRef(null)
  const peerConnectionRef = useRef(null)
  const localStreamRef = useRef(null)
  const remoteStreamRef = useRef(null)
  const mediaCallIdRef = useRef(null)
  const mediaBootstrapControllerRef = useRef(null)
  const signalPollControllerRef = useRef(null)
  const signalCursorRef = useRef('0')
  const pendingRemoteCandidatesRef = useRef([])
  const pendingLocalCandidatesRef = useRef([])
  const localSdpStoredRef = useRef(false)
  const remoteOfferRef = useRef(null)
  const remoteAnswerRef = useRef(null)
  const mediaSetupPromiseRef = useRef(null)
  const signalSendChainRef = useRef(Promise.resolve())
  const remoteAudioRef = useRef(null)
  const remoteVideoRef = useRef(null)
  const localVideoRef = useRef(null)

  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

  useEffect(() => {
    selectedConversationRef.current = selectedConversation
  }, [selectedConversation])

  useEffect(() => {
    mobilePaneRef.current = mobilePane
  }, [mobilePane])

  useEffect(() => {
    const viewport = messageViewportRef.current
    if (!viewport) return undefined

    function handleWheel(event) {
      if (window.innerWidth <= 820 || event.deltaY === 0) return

      const canScrollUp = viewport.scrollTop > 0
      const canScrollDown = (
        viewport.scrollTop + viewport.clientHeight < viewport.scrollHeight - 1
      )

      const shouldCapture = (
        (event.deltaY < 0 && canScrollUp) ||
        (event.deltaY > 0 && canScrollDown)
      )

      if (!shouldCapture) return

      const delta = event.deltaMode === 1
        ? event.deltaY * 16
        : event.deltaMode === 2
          ? event.deltaY * viewport.clientHeight
          : event.deltaY

      event.preventDefault()
      viewport.scrollTop += delta
    }

    viewport.addEventListener('wheel', handleWheel, { passive: false })

    return () => {
      viewport.removeEventListener('wheel', handleWheel)
    }
  }, [selectedConversation?.id])

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
    setAttachmentFile(null)
    setSendStage('')
    setError('')
    selectedConversationRef.current = null
    mobilePaneRef.current = 'list'
    pendingSendIdsRef.current.clear()
    pendingCallIdsRef.current.clear()
    cleanupMediaSession()
    readMarkedRef.current.clear()
    pendingReadRef.current = null
    currentCallRef.current = null
    setCurrentCall(null)
    setCallBusy(false)
    setCallError('')
    if (terminalCallTimerRef.current) {
      window.clearTimeout(terminalCallTimerRef.current)
      terminalCallTimerRef.current = null
    }
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
        requestError.code = payload?.code || ''
        throw requestError
      }

      return payload
    } finally {
      allControllersRef.current.delete(controller)
      pollControllersRef.current.delete(controller)
    }
  }

  function setCanonicalCall(call) {
    const previousCall = currentCallRef.current

    if (
      mediaCallIdRef.current &&
      (
        !call ||
        call.status !== 'accepted' ||
        (previousCall?.id && previousCall.id !== call.id)
      )
    ) {
      cleanupMediaSession()
    }

    if (terminalCallTimerRef.current) {
      window.clearTimeout(terminalCallTimerRef.current)
      terminalCallTimerRef.current = null
    }

    currentCallRef.current = call || null
    setCurrentCall(call || null)

    if (isTerminalCall(call)) {
      const terminalId = call.id
      terminalCallTimerRef.current = window.setTimeout(() => {
        const current = currentCallRef.current
        if (current?.id === terminalId && isTerminalCall(current)) {
          currentCallRef.current = null
          setCurrentCall(null)
        }
        terminalCallTimerRef.current = null
      }, 6000)
    }
  }

  function dismissCallState() {
    setCanonicalCall(null)
    setCallError('')
  }

  function callErrorText(requestError) {
    if (requestError?.code === 'CALL_BUSY') return 'CALL BUSY'
    if (requestError?.code === 'CALL_STATE_CONFLICT') return 'CALL STATE CHANGED'
    if (requestError?.status === 404) return 'CALL NO LONGER AVAILABLE'
    return requestError?.message || 'CALL REQUEST FAILED'
  }

  function cleanupMediaSession({ resetState = true } = {}) {
    mediaBootstrapControllerRef.current?.abort()
    signalPollControllerRef.current?.abort()
    mediaBootstrapControllerRef.current = null
    signalPollControllerRef.current = null

    const peer = peerConnectionRef.current
    if (peer) {
      peer.onicecandidate = null
      peer.ontrack = null
      peer.onconnectionstatechange = null
      peer.oniceconnectionstatechange = null

      try {
        peer.close()
      } catch {
        // Peer cleanup is best-effort.
      }
    }

    for (const track of localStreamRef.current?.getTracks?.() || []) {
      track.stop()
    }

    if (remoteAudioRef.current) remoteAudioRef.current.srcObject = null
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null
    if (localVideoRef.current) localVideoRef.current.srcObject = null

    peerConnectionRef.current = null
    localStreamRef.current = null
    remoteStreamRef.current = null
    mediaCallIdRef.current = null
    mediaSetupPromiseRef.current = null
    signalCursorRef.current = '0'
    pendingRemoteCandidatesRef.current = []
    pendingLocalCandidatesRef.current = []
    localSdpStoredRef.current = false
    remoteOfferRef.current = null
    remoteAnswerRef.current = null
    signalSendChainRef.current = Promise.resolve()

    if (resetState) {
      setSignalPollingReady(false)
      setMediaState('idle')
      setMediaError('')
      setMediaMuted(false)
      setCameraEnabled(true)
      setAutoplayBlocked(false)
      setMediaRevision((value) => value + 1)
    }
  }

  function mediaPermissionError(call, requestError) {
    if (requestError?.name === 'NotAllowedError') {
      return call?.kind === 'video'
        ? 'CAMERA / MICROPHONE PERMISSION REQUIRED'
        : 'MICROPHONE PERMISSION REQUIRED'
    }

    if (
      requestError?.name === 'NotFoundError' ||
      requestError?.name === 'NotReadableError'
    ) {
      return 'MEDIA DEVICE UNAVAILABLE'
    }

    return 'MEDIA SETUP FAILED'
  }

  function mediaConstraints(call) {
    const audio = {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    }

    if (call?.kind === 'video') {
      return {
        audio,
        video: {
          facingMode: {
            ideal: 'user',
          },
        },
      }
    }

    return {
      audio,
      video: false,
    }
  }

  async function acquireLocalMedia(call) {
    if (
      localStreamRef.current &&
      mediaCallIdRef.current === call.id
    ) {
      return localStreamRef.current
    }

    setMediaState('preparing')
    setMediaError('')

    if (!navigator.mediaDevices?.getUserMedia) {
      setMediaState('device-error')
      setMediaError('MEDIA DEVICE UNAVAILABLE')
      return null
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia(mediaConstraints(call))

      if (
        currentCallRef.current?.id !== call.id ||
        currentCallRef.current?.status !== 'accepted'
      ) {
        for (const track of stream.getTracks()) track.stop()
        return null
      }

      mediaCallIdRef.current = call.id
      localStreamRef.current = stream
      setMediaMuted(false)
      setCameraEnabled(true)
      setMediaRevision((value) => value + 1)
      return stream
    } catch (requestError) {
      setMediaState('device-error')
      setMediaError(mediaPermissionError(call, requestError))
      return null
    }
  }

  async function postSignalWithRetry(call, type, payload, clientSignalId = crypto.randomUUID()) {
    let lastError = null

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await requestJson('/api/comms/call-signals', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            callId: call.id,
            clientSignalId,
            type,
            payload,
          }),
        })

        if (!response.signal?.sequence) {
          throw new Error('The server did not return the canonical signal.')
        }

        return response.signal
      } catch (requestError) {
        lastError = requestError
        const retryable = (
          requestError?.name !== 'AbortError' &&
          (!requestError?.status || requestError.status >= 500)
        )

        if (!retryable || attempt === 2) throw requestError
        await sleep(250 * (attempt + 1))
      }
    }

    throw lastError || new Error('Signal could not be stored.')
  }

  function markSignalingFailure(requestError) {
    if (
      currentCallRef.current?.status !== 'accepted' ||
      requestError?.name === 'AbortError'
    ) {
      return
    }

    setMediaState('failed')
    setMediaError(
      requestError?.code === 'SIGNAL_STATE_CONFLICT'
        ? 'MEDIA SIGNALING STATE CHANGED'
        : 'MEDIA SIGNALING FAILED',
    )
  }

  function enqueueIceSignal(call, candidate) {
    signalSendChainRef.current = signalSendChainRef.current
      .then(() => postSignalWithRetry(call, 'ice', candidate))
      .catch((requestError) => {
        markSignalingFailure(requestError)
      })

    return signalSendChainRef.current
  }

  async function flushLocalCandidates(call) {
    const queued = pendingLocalCandidatesRef.current
    pendingLocalCandidatesRef.current = []

    for (const candidate of queued) {
      await postSignalWithRetry(call, 'ice', candidate)
    }
  }

  async function flushRemoteCandidates() {
    const peer = peerConnectionRef.current
    if (!peer?.remoteDescription) return

    const queued = pendingRemoteCandidatesRef.current
      .slice()
      .sort((left, right) => {
        const leftSequence = BigInt(left.sequence)
        const rightSequence = BigInt(right.sequence)
        if (leftSequence === rightSequence) return 0
        return leftSequence < rightSequence ? -1 : 1
      })

    pendingRemoteCandidatesRef.current = []

    for (const item of queued) {
      await peer.addIceCandidate(item.payload)
    }
  }

  async function attemptRemotePlayback() {
    const call = currentCallRef.current
    if (call?.status !== 'accepted') return

    const remoteElement = call.kind === 'video'
      ? remoteVideoRef.current
      : remoteAudioRef.current
    const remoteStream = remoteStreamRef.current

    if (!remoteElement || !remoteStream || remoteStream.getTracks().length === 0) return

    if (remoteElement.srcObject !== remoteStream) {
      remoteElement.srcObject = remoteStream
    }

    try {
      const playResult = remoteElement.play()
      if (playResult?.then) await playResult
      setAutoplayBlocked(false)
    } catch {
      setAutoplayBlocked(true)
    }
  }

  function updatePeerConnectionState(call, peer) {
    if (
      mediaCallIdRef.current !== call.id ||
      currentCallRef.current?.status !== 'accepted'
    ) {
      return
    }

    if (peer.connectionState === 'connected') {
      setMediaState('live')
      setMediaError('')
      window.setTimeout(() => {
        attemptRemotePlayback()
      }, 0)
      return
    }

    if (peer.connectionState === 'failed' || peer.iceConnectionState === 'failed') {
      setMediaState('failed')
      setMediaError('DIRECT MEDIA PATH FAILED')
      return
    }

    if (
      peer.connectionState === 'disconnected' ||
      peer.iceConnectionState === 'disconnected'
    ) {
      setMediaState('interrupted')
      return
    }

    if (
      peer.connectionState === 'connecting' ||
      peer.iceConnectionState === 'checking'
    ) {
      setMediaState('connecting')
    }
  }

  function createPeerConnectionForCall(call, localStream) {
    if (
      peerConnectionRef.current &&
      mediaCallIdRef.current === call.id
    ) {
      return peerConnectionRef.current
    }

    const peer = new RTCPeerConnection({
      iceServers: [
        {
          urls: 'stun:stun.cloudflare.com:3478',
        },
      ],
    })
    const remoteStream = new MediaStream()

    mediaCallIdRef.current = call.id
    peerConnectionRef.current = peer
    remoteStreamRef.current = remoteStream

    peer.onicecandidate = (event) => {
      if (!event.candidate) return

      const candidate = event.candidate.toJSON()
      if (!localSdpStoredRef.current) {
        pendingLocalCandidatesRef.current.push(candidate)
        return
      }

      enqueueIceSignal(call, candidate)
    }

    peer.ontrack = (event) => {
      const targetStream = remoteStreamRef.current
      if (!targetStream) return

      const tracks = event.streams?.[0]?.getTracks?.() || [event.track]
      for (const track of tracks) {
        if (!track || targetStream.getTracks().some((current) => current.id === track.id)) {
          continue
        }
        targetStream.addTrack(track)
      }

      setMediaRevision((value) => value + 1)
      window.setTimeout(() => {
        attemptRemotePlayback()
      }, 0)
    }

    peer.onconnectionstatechange = () => {
      updatePeerConnectionState(call, peer)
    }

    peer.oniceconnectionstatechange = () => {
      updatePeerConnectionState(call, peer)
    }

    for (const track of localStream.getTracks()) {
      peer.addTrack(track, localStream)
    }

    setMediaState('connecting')
    setMediaRevision((value) => value + 1)
    return peer
  }

  async function beginCallerMedia(call) {
    if (mediaSetupPromiseRef.current) return mediaSetupPromiseRef.current

    mediaSetupPromiseRef.current = (async () => {
      const stream = await acquireLocalMedia(call)
      if (!stream) return false

      try {
        const peer = createPeerConnectionForCall(call, stream)
        const offer = await peer.createOffer()
        await peer.setLocalDescription(offer)

        await postSignalWithRetry(call, 'offer', {
          type: peer.localDescription.type,
          sdp: peer.localDescription.sdp,
        })

        localSdpStoredRef.current = true
        await flushLocalCandidates(call)
        setMediaState('connecting')
        return true
      } catch (requestError) {
        markSignalingFailure(requestError)
        return false
      }
    })().finally(() => {
      mediaSetupPromiseRef.current = null
    })

    return mediaSetupPromiseRef.current
  }

  async function beginCalleeMedia(call, offerPayload) {
    remoteOfferRef.current = offerPayload

    if (mediaSetupPromiseRef.current) return mediaSetupPromiseRef.current

    mediaSetupPromiseRef.current = (async () => {
      const stream = await acquireLocalMedia(call)
      if (!stream) return false

      try {
        const peer = createPeerConnectionForCall(call, stream)
        await peer.setRemoteDescription(offerPayload)
        await flushRemoteCandidates()

        const answer = await peer.createAnswer()
        await peer.setLocalDescription(answer)

        await postSignalWithRetry(call, 'answer', {
          type: peer.localDescription.type,
          sdp: peer.localDescription.sdp,
        })

        localSdpStoredRef.current = true
        await flushLocalCandidates(call)
        setMediaState('connecting')
        return true
      } catch (requestError) {
        markSignalingFailure(requestError)
        return false
      }
    })().finally(() => {
      mediaSetupPromiseRef.current = null
    })

    return mediaSetupPromiseRef.current
  }

  async function processRemoteSignal(call, signal) {
    if (!signal?.sequence || signal.senderAccountId === account?.id) return

    if (signal.type === 'offer') {
      remoteOfferRef.current = signal.payload

      if (call.calleeAccountId === account?.id) {
        await beginCalleeMedia(call, signal.payload)
      }
      return
    }

    if (signal.type === 'answer') {
      remoteAnswerRef.current = signal.payload

      if (call.callerAccountId !== account?.id) return

      const peer = peerConnectionRef.current
      if (!peer) {
        setSignalPollingReady(false)
        setMediaState('redial')
        setMediaError('')
        return
      }

      if (!peer.remoteDescription) {
        try {
          await peer.setRemoteDescription(signal.payload)
          await flushRemoteCandidates()
        } catch {
          setMediaState('failed')
          setMediaError('REMOTE MEDIA DESCRIPTION FAILED')
        }
      }
      return
    }

    if (signal.type === 'ice') {
      const peer = peerConnectionRef.current

      if (!peer?.remoteDescription) {
        pendingRemoteCandidatesRef.current.push({
          sequence: signal.sequence,
          payload: signal.payload,
        })
        return
      }

      try {
        await peer.addIceCandidate(signal.payload)
      } catch {
        setMediaState('failed')
        setMediaError('MEDIA CANDIDATE FAILED')
      }
    }
  }

  async function fetchSignalBacklog(callId, after = '0', controller = null) {
    let cursor = after
    const signals = []

    while (true) {
      const payload = await requestJson(
        `/api/comms/call-signals?callId=${encodeURIComponent(callId)}&after=${encodeURIComponent(cursor)}`,
        {},
        controller,
      )

      const page = Array.isArray(payload.signals) ? payload.signals : []
      signals.push(...page)

      const nextAfter = typeof payload.nextAfter === 'string'
        ? payload.nextAfter
        : cursor

      if (nextAfter === cursor && payload.hasMore) {
        throw new Error('Signal cursor did not advance.')
      }

      cursor = nextAfter
      if (!payload.hasMore) break
    }

    return {
      signals,
      nextAfter: cursor,
    }
  }

  async function pollSignalCatchup(call, controller = null) {
    let cursor = signalCursorRef.current

    while (true) {
      const payload = await requestJson(
        `/api/comms/call-signals?callId=${encodeURIComponent(call.id)}&after=${encodeURIComponent(cursor)}`,
        {},
        controller,
      )

      const signals = Array.isArray(payload.signals) ? payload.signals : []

      for (const signal of signals) {
        await processRemoteSignal(call, signal)
        cursor = signal.sequence
        signalCursorRef.current = cursor
      }

      const nextAfter = typeof payload.nextAfter === 'string'
        ? payload.nextAfter
        : cursor

      if (signals.length === 0) {
        cursor = nextAfter
        signalCursorRef.current = cursor
      }

      if (!payload.hasMore) break
      if (nextAfter === cursor && signals.length === 0) {
        throw new Error('Signal cursor did not advance.')
      }
    }
  }

  async function bootstrapAcceptedMedia(call, controller) {
    cleanupMediaSession()
    mediaCallIdRef.current = call.id
    setMediaState('preparing')
    setMediaError('')

    try {
      const backlog = await fetchSignalBacklog(call.id, '0', controller)
      signalCursorRef.current = backlog.nextAfter

      if (
        currentCallRef.current?.id !== call.id ||
        currentCallRef.current?.status !== 'accepted'
      ) {
        return
      }

      const caller = call.callerAccountId === account?.id
      const ownOffer = backlog.signals.find(
        (signal) => signal.type === 'offer' && signal.senderAccountId === account?.id,
      )
      const ownAnswer = backlog.signals.find(
        (signal) => signal.type === 'answer' && signal.senderAccountId === account?.id,
      )

      if ((caller && ownOffer) || (!caller && ownAnswer)) {
        setSignalPollingReady(false)
        setMediaState('redial')
        setMediaError('')
        return
      }

      if (caller) {
        const started = await beginCallerMedia(call)
        setSignalPollingReady(Boolean(started))
        return
      }

      setSignalPollingReady(true)

      let sawOffer = false
      for (const signal of backlog.signals) {
        if (signal.type === 'offer' && signal.senderAccountId !== account?.id) {
          sawOffer = true
        }
        await processRemoteSignal(call, signal)
      }

      if (!sawOffer) {
        setMediaState('waiting-offer')
      } else if (!peerConnectionRef.current) {
        setSignalPollingReady(false)
      }
    } catch (requestError) {
      if (requestError?.name !== 'AbortError') {
        markSignalingFailure(requestError)
      }
    }
  }

  function retryMedia() {
    const call = currentCallRef.current
    if (call?.status !== 'accepted') return

    cleanupMediaSession()
    setMediaRetryNonce((value) => value + 1)
  }

  function toggleMicrophone() {
    const tracks = localStreamRef.current?.getAudioTracks?.() || []
    if (!tracks.length) return

    const nextEnabled = mediaMuted
    for (const track of tracks) {
      track.enabled = nextEnabled
    }
    setMediaMuted(!nextEnabled)
  }

  function toggleCamera() {
    const tracks = localStreamRef.current?.getVideoTracks?.() || []
    if (!tracks.length) return

    const nextEnabled = !cameraEnabled
    for (const track of tracks) {
      track.enabled = nextEnabled
    }
    setCameraEnabled(nextEnabled)
  }

  async function resumeRemotePlayback() {
    await attemptRemotePlayback()
  }

  async function startCall(kind) {
    const conversationId = selectedConversationRef.current?.id
    if (!conversationId || isActiveCall(currentCallRef.current) || callBusy) return

    const pendingKey = `${conversationId}\u0000${kind}`
    const clientCallId = pendingCallIdsRef.current.get(pendingKey) || crypto.randomUUID()
    pendingCallIdsRef.current.set(pendingKey, clientCallId)

    setCallBusy(true)
    setCallError('')

    try {
      const payload = await requestJson('/api/comms/calls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId,
          clientCallId,
          kind,
        }),
      })

      if (!payload.call?.id) {
        throw new Error('The server did not return the canonical call.')
      }

      pendingCallIdsRef.current.delete(pendingKey)
      setCanonicalCall(payload.call)
    } catch (requestError) {
      if (
        requestError?.name !== 'AbortError' &&
        Number.isInteger(requestError?.status) &&
        requestError.status < 500
      ) {
        pendingCallIdsRef.current.delete(pendingKey)
      }

      if (requestError?.name !== 'AbortError') {
        setCallError(callErrorText(requestError))
      }
    } finally {
      setCallBusy(false)
    }
  }

  async function actOnCall(action) {
    const call = currentCallRef.current
    if (!call?.id || callBusy) return

    setCallBusy(true)
    setCallError('')

    try {
      const payload = await requestJson('/api/comms/calls', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          callId: call.id,
          action,
        }),
      })

      if (!payload.call?.id) {
        throw new Error('The server did not return the canonical call.')
      }

      setCanonicalCall(payload.call)

      if (action === 'accept' && payload.call.status === 'accepted') {
        const nextConversations = await loadConversations({ quiet: true })
        const targetConversation = nextConversations.find(
          (conversation) => conversation.id === payload.call.conversationId,
        )

        if (
          targetConversation &&
          selectedConversationRef.current?.id !== targetConversation.id
        ) {
          await selectConversation(targetConversation)
        }
      }
    } catch (requestError) {
      if (requestError?.name !== 'AbortError') {
        setCallError(callErrorText(requestError))
      }
    } finally {
      setCallBusy(false)
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

  useEffect(() => {
    if (!account?.id) return undefined

    let callTimer = null
    let callController = null

    const clearCallPolling = () => {
      if (callTimer) window.clearInterval(callTimer)
      callTimer = null
      callController?.abort()
      callController = null
    }

    const pollCall = async () => {
      if (document.hidden || callController) return

      const knownCall = currentCallRef.current
      const pollingSpecific = isActiveCall(knownCall)
      const url = pollingSpecific
        ? `/api/comms/calls?id=${encodeURIComponent(knownCall.id)}`
        : '/api/comms/calls'

      const controller = new AbortController()
      callController = controller

      try {
        const payload = await requestJson(url, {}, controller)

        if (payload.call) {
          setCanonicalCall(payload.call)
          setCallError('')
        } else if (!knownCall || pollingSpecific) {
          setCanonicalCall(null)
        }
      } catch (requestError) {
        if (requestError?.name !== 'AbortError') {
          if (requestError?.status === 404 && pollingSpecific) {
            setCanonicalCall(null)
          } else {
            console.error('COMMS call poll failed', requestError)
          }
        }
      } finally {
        if (callController === controller) {
          callController = null
        }
      }
    }

    const startCallPolling = () => {
      if (document.hidden) return
      pollCall()
      callTimer = window.setInterval(pollCall, 2000)
    }

    const restartCallPolling = () => {
      clearCallPolling()
      if (!document.hidden) startCallPolling()
    }

    const handleCallVisibility = () => {
      if (document.hidden) {
        clearCallPolling()
      } else {
        startCallPolling()
      }
    }

    const handleCallRecovery = () => {
      if (!document.hidden) restartCallPolling()
    }

    startCallPolling()
    document.addEventListener('visibilitychange', handleCallVisibility)
    window.addEventListener('focus', handleCallRecovery)
    window.addEventListener('pageshow', handleCallRecovery)
    window.addEventListener('online', handleCallRecovery)

    return () => {
      document.removeEventListener('visibilitychange', handleCallVisibility)
      window.removeEventListener('focus', handleCallRecovery)
      window.removeEventListener('pageshow', handleCallRecovery)
      window.removeEventListener('online', handleCallRecovery)
      clearCallPolling()
    }
  }, [account?.id])

  useEffect(() => {
    const localVideo = localVideoRef.current
    const localStream = localStreamRef.current

    if (localVideo && localStream && localVideo.srcObject !== localStream) {
      localVideo.srcObject = localStream
      localVideo.muted = true
      const playResult = localVideo.play()
      playResult?.catch?.(() => {})
    }

    const call = currentCallRef.current
    const remoteStream = remoteStreamRef.current
    const remoteElement = call?.kind === 'video'
      ? remoteVideoRef.current
      : remoteAudioRef.current

    if (remoteElement && remoteStream && remoteElement.srcObject !== remoteStream) {
      remoteElement.srcObject = remoteStream
    }

    if (remoteStream?.getTracks?.().length) {
      window.setTimeout(() => {
        attemptRemotePlayback()
      }, 0)
    }
  }, [currentCall?.id, currentCall?.kind, mediaRevision])

  useEffect(() => {
    const call = currentCall
    if (!account?.id || call?.status !== 'accepted') {
      if (mediaCallIdRef.current) {
        cleanupMediaSession()
      }
      return undefined
    }

    const controller = new AbortController()
    mediaBootstrapControllerRef.current?.abort()
    mediaBootstrapControllerRef.current = controller

    bootstrapAcceptedMedia(call, controller)

    return () => {
      if (mediaBootstrapControllerRef.current === controller) {
        controller.abort()
        mediaBootstrapControllerRef.current = null
      }
    }
  }, [account?.id, currentCall?.id, currentCall?.status, mediaRetryNonce])

  useEffect(() => {
    const call = currentCall
    if (
      !account?.id ||
      call?.status !== 'accepted' ||
      !signalPollingReady
    ) {
      return undefined
    }

    let timer = null
    let controller = null
    let inFlight = false
    const cadence = mediaState === 'live' ? 5000 : 900

    const pollSignals = async () => {
      if (document.hidden || inFlight) return

      inFlight = true
      controller = new AbortController()
      signalPollControllerRef.current = controller

      try {
        await pollSignalCatchup(call, controller)
      } catch (requestError) {
        if (
          requestError?.name !== 'AbortError' &&
          requestError?.code !== 'SIGNAL_STATE_CONFLICT'
        ) {
          console.error('COMMS media signaling poll failed', {
            code: requestError?.code || null,
            name: requestError?.name || null,
            status: requestError?.status || null,
          })
        }
      } finally {
        if (signalPollControllerRef.current === controller) {
          signalPollControllerRef.current = null
        }
        controller = null
        inFlight = false
      }
    }

    pollSignals()
    timer = window.setInterval(pollSignals, cadence)

    return () => {
      if (timer) window.clearInterval(timer)
      controller?.abort()
      if (signalPollControllerRef.current === controller) {
        signalPollControllerRef.current = null
      }
    }
  }, [
    account?.id,
    currentCall?.id,
    currentCall?.status,
    signalPollingReady,
    mediaState,
  ])

  useEffect(() => () => {
    if (terminalCallTimerRef.current) {
      window.clearTimeout(terminalCallTimerRef.current)
      terminalCallTimerRef.current = null
    }
    cleanupMediaSession({ resetState: false })
  }, [])

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

  function handleAttachmentSelection(event) {
    const file = event.target.files?.[0] || null
    if (!file) {
      setAttachmentFile(null)
      return
    }

    if (!isAllowedAttachmentType(file.type)) {
      setError('That attachment type is not supported.')
      event.target.value = ''
      setAttachmentFile(null)
      return
    }

    if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > MAX_ATTACHMENT_BYTES) {
      setError('Attachments must be between 1 byte and 10 MiB.')
      event.target.value = ''
      setAttachmentFile(null)
      return
    }

    setError('')
    setAttachmentFile(file)
  }

  function removeAttachment() {
    setAttachmentFile(null)
    if (attachmentInputRef.current) {
      attachmentInputRef.current.value = ''
    }
  }

  async function sendMessage() {
    const conversationId = selectedConversation?.id
    const body = draft.trim()
    const file = attachmentFile
    if (!conversationId || (!body && !file) || sendBusy) return

    const messageLength = Array.from(body).length
    if (messageLength > 4000) {
      setError('Messages are limited to 4000 characters.')
      return
    }

    if (file) {
      if (!isAllowedAttachmentType(file.type)) {
        setError('That attachment type is not supported.')
        return
      }
      if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > MAX_ATTACHMENT_BYTES) {
        setError('Attachments must be between 1 byte and 10 MiB.')
        return
      }
    }

    const safeName = file ? safeAttachmentName(file.name) : ''
    const fileFingerprint = file
      ? `${safeName}\u0000${file.type}\u0000${file.size}\u0000${file.lastModified}`
      : ''
    const pendingKey = `${conversationId}\u0000${body}\u0000${fileFingerprint}`
    let pending = pendingSendIdsRef.current.get(pendingKey)

    if (!pending) {
      pending = {
        clientMessageId: crypto.randomUUID(),
        attachment: null,
      }
      pendingSendIdsRef.current.set(pendingKey, pending)
    }

    setSendBusy(true)
    setSendStage(file && !pending.attachment ? 'uploading' : 'sending')
    setError('')

    try {
      if (file && !pending.attachment) {
        const authorization = await requestJson('/api/comms/attachment-upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            conversationId,
            originalName: safeName,
            contentType: file.type,
            byteSize: file.size,
          }),
        })

        if (!authorization.upload?.url || !authorization.upload?.key) {
          throw new Error('The attachment upload was not authorized correctly.')
        }

        const uploadResponse = await fetch(authorization.upload.url, {
          method: 'PUT',
          headers: {
            'Content-Type': file.type,
          },
          body: file,
        })

        if (!uploadResponse.ok) {
          const uploadError = new Error('Attachment upload failed.')
          uploadError.status = uploadResponse.status
          throw uploadError
        }

        pending.attachment = {
          key: authorization.upload.key,
          originalName: safeName,
        }
        pendingSendIdsRef.current.set(pendingKey, pending)
      }

      setSendStage('sending')

      const payload = await requestJson('/api/comms/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId,
          clientMessageId: pending.clientMessageId,
          body,
          attachment: pending.attachment,
        }),
      })

      if (!payload.message?.id) {
        throw new Error('The server did not return the saved message.')
      }

      pendingSendIdsRef.current.delete(pendingKey)
      shouldScrollRef.current = true
      setMessages((current) => dedupeMessages([...current, payload.message]))
      setDraft('')
      removeAttachment()

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
            ? 'Send status is uncertain. Retry the same message to reuse its canonical send state safely.'
            : requestError?.message || 'Message could not be sent.',
        )
      }
    } finally {
      setSendStage('')
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
  const currentCallIsCaller = currentCall?.callerAccountId === account?.id
  const currentCallIsCallee = currentCall?.calleeAccountId === account?.id

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

      {(currentCall || callError) && (
        <section
          className={`comms-call-strip${currentCall?.status ? ` status-${currentCall.status}` : ' status-error'}`}
          aria-label="COMMS call state"
        >
          {callError && (
            <div className="comms-call-error" role="alert">
              <strong>{callError}</strong>
              <button type="button" onClick={() => setCallError('')}>DISMISS</button>
            </div>
          )}

          {currentCall?.status === 'ringing' && currentCallIsCaller && (
            <>
              <div className="comms-call-copy">
                <span>CALLING @{currentCall.otherAccount?.handle || 'account'}</span>
                <strong>{callKindLabel(currentCall)} CALL</strong>
                <small>WAITING FOR ANSWER</small>
              </div>
              <div className="comms-call-actions">
                <button
                  type="button"
                  onClick={() => actOnCall('cancel')}
                  disabled={callBusy}
                >
                  {callBusy ? 'WORKING…' : 'CANCEL'}
                </button>
              </div>
            </>
          )}

          {currentCall?.status === 'ringing' && currentCallIsCallee && (
            <>
              <div className="comms-call-copy">
                <span>INCOMING {callKindLabel(currentCall)} CALL</span>
                <strong>@{currentCall.otherAccount?.handle || 'account'}</strong>
                <small>CALL SESSION REQUEST</small>
              </div>
              <div className="comms-call-actions">
                <button
                  type="button"
                  onClick={() => actOnCall('accept')}
                  disabled={callBusy}
                >
                  {callBusy ? 'WORKING…' : 'ACCEPT'}
                </button>
                <button
                  type="button"
                  onClick={() => actOnCall('decline')}
                  disabled={callBusy}
                >
                  DECLINE
                </button>
              </div>
            </>
          )}

          {currentCall?.status === 'accepted' && (
            <>
              <div className="comms-call-copy">
                <span>{callKindLabel(currentCall)} CALL</span>
                <strong>SIGNALING READY</strong>
                <small>MEDIA CONNECTS IN STAGE 4D.2</small>
              </div>
              <div className="comms-call-actions">
                <button
                  type="button"
                  onClick={() => actOnCall('end')}
                  disabled={callBusy}
                >
                  {callBusy ? 'WORKING…' : 'END CALL'}
                </button>
              </div>
            </>
          )}

          {isTerminalCall(currentCall) && (
            <>
              <div className="comms-call-copy">
                <span>{callKindLabel(currentCall)} CALL</span>
                <strong>{terminalCallLabel(currentCall)}</strong>
                <small>@{currentCall.otherAccount?.handle || 'account'}</small>
              </div>
              <div className="comms-call-actions">
                <button type="button" onClick={dismissCallState}>DISMISS</button>
              </div>
            </>
          )}
        </section>
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
                  <small>
                    @{conversation.otherAccount?.handle || 'unknown'}
                    <span
                      className={`comms-presence${conversation.otherPresence?.isOnline ? ' online' : ''}`}
                    >
                      {presenceText(conversation.otherPresence)}
                    </span>
                  </small>
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
                <div className="comms-chat-party">
                  <strong>{selectedConversation.otherAccount?.displayName}</strong>
                  <small>
                    @{selectedConversation.otherAccount?.handle}
                    <span
                      className={`comms-presence${selectedConversation.otherPresence?.isOnline ? ' online' : ''}`}
                    >
                      {presenceText(selectedConversation.otherPresence)}
                    </span>
                  </small>
                </div>
                {!isActiveCall(currentCall) && (
                  <div className="comms-call-start" aria-label="Start call">
                    <button
                      type="button"
                      onClick={() => startCall('audio')}
                      disabled={callBusy}
                    >
                      AUDIO
                    </button>
                    <button
                      type="button"
                      onClick={() => startCall('video')}
                      disabled={callBusy}
                    >
                      VIDEO
                    </button>
                  </div>
                )}
              </header>

              <nav
                className="comms-mobile-switcher"
                aria-label="Quick switch conversations"
              >
                {conversations.map((conversation) => {
                  const unreadCount = numericUnreadCount(conversation.unreadCount)
                  const isCurrent = selectedConversation?.id === conversation.id
                  const label = conversation.otherAccount?.displayName
                    || conversation.otherAccount?.handle
                    || 'WildCard Account'

                  return (
                    <button
                      type="button"
                      key={conversation.id}
                      className={isCurrent ? 'active' : ''}
                      aria-current={isCurrent ? 'true' : undefined}
                      aria-label={`Open conversation with ${label}${
                        unreadCount > 0
                          ? `, ${unreadCount} unread message${unreadCount === 1 ? '' : 's'}`
                          : ''
                      }`}
                      onClick={() => selectConversation(conversation)}
                    >
                      <span className="comms-mobile-switcher-sigil" aria-hidden="true">
                        {initials(conversation.otherAccount)}
                      </span>
                      <span className="comms-mobile-switcher-copy">
                        <strong>{label}</strong>
                        <small>
                          @{conversation.otherAccount?.handle || 'unknown'}
                          {conversation.otherPresence?.isOnline && (
                            <b aria-label="Online"> ONLINE</b>
                          )}
                        </small>
                      </span>
                      {unreadCount > 0 && (
                        <span
                          className="comms-unread-badge"
                          aria-hidden="true"
                        >
                          {displayUnreadCount(unreadCount)}
                        </span>
                      )}
                    </button>
                  )
                })}
              </nav>

              <div className="comms-history-tools">
                {hasOlder ? (
                  <button type="button" onClick={loadEarlier} disabled={historyBusy}>
                    {historyBusy ? 'LOADING…' : 'LOAD EARLIER'}
                  </button>
                ) : (
                  <span>START OF LOADED HISTORY</span>
                )}
              </div>

              <div
                className="comms-messages"
                ref={messageViewportRef}
              >
                {historyBusy && messages.length === 0 && (
                  <p className="comms-empty">Loading message history…</p>
                )}

                {!historyBusy && messages.length === 0 && (
                  <p className="comms-empty">No messages yet. Open the line.</p>
                )}

                {messages.map((message) => {
                  const outgoing = message.senderAccountId === account.id
                  const attachment = message.attachment
                  const attachmentUrl = attachment?.id
                    ? `/api/comms/attachment?id=${encodeURIComponent(attachment.id)}`
                    : ''
                  const isMedia = Boolean(attachment?.isAudio || attachment?.isVideo)
                  const canPlayMedia = isMedia && canPlayAttachmentMedia(attachment)

                  return (
                    <Fragment key={message.id}>
                      <article
                        className={`comms-message ${outgoing ? 'outgoing' : 'incoming'}`}
                      >
                        <span>{outgoing ? 'YOU' : 'INCOMING'}</span>
                        {message.body && <p>{message.body}</p>}
                        {attachment?.isImage && attachmentUrl && (
                          <img
                            className="comms-attachment-image"
                            src={attachmentUrl}
                            alt={attachment.name}
                            loading="lazy"
                          />
                        )}
                        {attachment && !attachment.isImage && (
                          <div className="comms-file-card" aria-label={attachment.name}>
                            <strong>
                              {attachment.isAudio ? '♫' : attachment.isVideo ? '▶' : '📎'} {attachment.name}
                            </strong>
                            <small>
                              {attachment.contentType} • {readableBytes(attachment.size)}
                            </small>
                          </div>
                        )}
                        {outgoing && newestOutgoingRead && message.id === newestOutgoingMessage?.id && (
                          <small className="comms-read-receipt">READ</small>
                        )}
                      </article>

                      {isMedia && attachmentUrl && (
                        <div className={`comms-media-actions${outgoing ? ' outgoing' : ''}`}>
                          {canPlayMedia && attachment.isAudio && (
                            <audio
                              className="comms-media-player comms-audio-player"
                              controls
                              preload="metadata"
                              src={attachmentUrl}
                            />
                          )}
                          {canPlayMedia && attachment.isVideo && (
                            <video
                              className="comms-media-player comms-video-player"
                              controls
                              playsInline
                              preload="metadata"
                              src={attachmentUrl}
                            />
                          )}
                          <a
                            className="comms-file-download"
                            href={attachmentUrl}
                            download={attachment.name}
                          >
                            DOWNLOAD
                          </a>
                        </div>
                      )}

                      {attachment && !attachment.isImage && !isMedia && attachmentUrl && (
                        <a
                          className={`comms-file-download${outgoing ? ' outgoing' : ''}`}
                          href={attachmentUrl}
                        >
                          DOWNLOAD
                        </a>
                      )}
                    </Fragment>
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
                <input
                  ref={attachmentInputRef}
                  className="comms-attachment-input"
                  type="file"
                  accept={ATTACHMENT_ACCEPT}
                  onChange={handleAttachmentSelection}
                />
                <div className="comms-attachment-tools">
                  <button
                    type="button"
                    onClick={() => attachmentInputRef.current?.click()}
                    disabled={sendBusy}
                  >
                    ATTACH
                  </button>
                  {attachmentFile && (
                    <span className="comms-pending-attachment">
                      <b>{safeAttachmentName(attachmentFile.name)}</b>
                      <small>{readableBytes(attachmentFile.size)}</small>
                      <button type="button" onClick={removeAttachment} disabled={sendBusy}>
                        REMOVE
                      </button>
                    </span>
                  )}
                </div>
                <div>
                  <small>ENTER sends • SHIFT+ENTER adds a line</small>
                  <button
                    type="button"
                    onClick={sendMessage}
                    disabled={sendBusy || (!draft.trim() && !attachmentFile)}
                  >
                    {sendStage === 'uploading'
                      ? 'UPLOADING…'
                      : sendBusy
                        ? 'SENDING…'
                        : 'SEND'}
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
