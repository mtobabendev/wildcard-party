import { useEffect, useRef, useState } from 'react'

const SIGNAL_TYPES = new Set([
  'invite',
  'accept',
  'decline',
  'offer',
  'answer',
  'ice',
  'hangup',
])

export default function AudioCall({ account, conversation }) {
  const [signalState, setSignalState] = useState('connecting')
  const [callState, setCallStateValue] = useState('idle')
  const [incomingCallId, setIncomingCallId] = useState('')
  const [playBlocked, setPlayBlocked] = useState(false)
  const [error, setError] = useState('')
  const [reconnectToken, setReconnectToken] = useState(0)

  const socketRef = useRef(null)
  const peerRef = useRef(null)
  const localStreamRef = useRef(null)
  const remoteStreamRef = useRef(null)
  const remoteIceRef = useRef([])
  const iceServersRef = useRef([])
  const activeCallIdRef = useRef('')
  const callStateRef = useRef('idle')
  const lifecycleTokenRef = useRef(0)
  const audioRef = useRef(null)

  function setCallState(next) {
    callStateRef.current = next
    setCallStateValue(next)
  }

  function setActiveCallId(next) {
    activeCallIdRef.current = next
  }

  function sendSignal(type, callId, payload) {
    const socket = socketRef.current
    if (!socket || socket.readyState !== WebSocket.OPEN) return false

    socket.send(JSON.stringify({
      type,
      callId,
      ...(payload === undefined ? {} : { payload }),
    }))
    return true
  }

  function sendActiveHangup() {
    const callId = activeCallIdRef.current
    if (!callId) return false
    return sendSignal('hangup', callId)
  }

  function cleanupCall(nextState = 'idle') {
    const peer = peerRef.current
    if (peer) {
      peer.onicecandidate = null
      peer.ontrack = null
      peer.onconnectionstatechange = null
      peer.close()
      peerRef.current = null
    }

    const localStream = localStreamRef.current
    if (localStream) {
      for (const track of localStream.getTracks()) {
        track.stop()
      }
      localStreamRef.current = null
    }

    remoteStreamRef.current = null
    remoteIceRef.current = []
    setActiveCallId('')
    setIncomingCallId('')
    setPlayBlocked(false)

    if (audioRef.current) {
      audioRef.current.srcObject = null
    }

    setCallState(nextState)
  }

  async function flushRemoteIce(peer) {
    if (!peer?.remoteDescription) return

    const queued = remoteIceRef.current
    remoteIceRef.current = []

    for (const candidate of queued) {
      await peer.addIceCandidate(candidate)
    }
  }

  function createPeer(callId) {
    if (peerRef.current) return peerRef.current

    const iceServers = iceServersRef.current
    if (!Array.isArray(iceServers) || !iceServers.length) {
      throw new Error('Audio traversal is unavailable.')
    }

    const peer = new RTCPeerConnection({
      iceServers,
    })
    peerRef.current = peer

    const localStream = localStreamRef.current
    if (localStream) {
      for (const track of localStream.getAudioTracks()) {
        peer.addTrack(track, localStream)
      }
    }

    peer.onicecandidate = (event) => {
      if (!event.candidate || activeCallIdRef.current !== callId) return
      sendSignal(
        'ice',
        callId,
        typeof event.candidate.toJSON === 'function'
          ? event.candidate.toJSON()
          : event.candidate,
      )
    }

    peer.ontrack = (event) => {
      let remoteStream = remoteStreamRef.current
      if (!remoteStream) {
        remoteStream = new MediaStream()
        remoteStreamRef.current = remoteStream
      }

      if (!remoteStream.getTracks().some((track) => track.id === event.track.id)) {
        remoteStream.addTrack(event.track)
      }

      if (audioRef.current) {
        audioRef.current.srcObject = remoteStream
        const playback = audioRef.current.play()
        if (playback?.catch) {
          playback
            .then(() => setPlayBlocked(false))
            .catch(() => setPlayBlocked(true))
        }
      }
    }

    peer.onconnectionstatechange = () => {
      if (peerRef.current !== peer) return

      if (peer.connectionState === 'connected') {
        setCallState('connected')
      } else if (peer.connectionState === 'failed') {
        setError('Audio connection failed.')
        sendActiveHangup()
        cleanupCall('idle')
      }
    }

    return peer
  }

  async function handleSignal(event) {
    let signal
    try {
      signal = JSON.parse(event.data)
    } catch {
      return
    }

    if (!SIGNAL_TYPES.has(signal?.type) || typeof signal?.callId !== 'string') return

    const currentCallId = activeCallIdRef.current
    if (!currentCallId) {
      if (signal.type !== 'invite' || callStateRef.current !== 'idle') return

      setActiveCallId(signal.callId)
      setIncomingCallId(signal.callId)
      setCallState('incoming')
      return
    }

    if (signal.callId !== currentCallId) return

    try {
      if (signal.type === 'decline') {
        cleanupCall('idle')
        return
      }

      if (signal.type === 'hangup') {
        cleanupCall('idle')
        return
      }

      if (signal.type === 'accept') {
        if (callStateRef.current !== 'inviting' || !localStreamRef.current) return

        setCallState('connecting')
        const peer = createPeer(currentCallId)
        const offer = await peer.createOffer()
        await peer.setLocalDescription(offer)
        sendSignal('offer', currentCallId, offer)
        return
      }

      if (signal.type === 'offer') {
        if (callStateRef.current !== 'connecting' || !peerRef.current) return

        const peer = peerRef.current
        await peer.setRemoteDescription(signal.payload)
        await flushRemoteIce(peer)
        const answer = await peer.createAnswer()
        await peer.setLocalDescription(answer)
        sendSignal('answer', currentCallId, answer)
        return
      }

      if (signal.type === 'answer') {
        const peer = peerRef.current
        if (!peer || callStateRef.current !== 'connecting') return

        await peer.setRemoteDescription(signal.payload)
        await flushRemoteIce(peer)
        return
      }

      if (signal.type === 'ice') {
        const peer = peerRef.current
        if (!peer || !peer.remoteDescription) {
          remoteIceRef.current.push(signal.payload)
          return
        }

        await peer.addIceCandidate(signal.payload)
      }
    } catch {
      setError('Audio negotiation failed.')
      sendActiveHangup()
      cleanupCall('idle')
    }
  }

  useEffect(() => {
    let disposed = false
    let intentionalClose = false
    let socket = null

    lifecycleTokenRef.current += 1
    const lifecycleToken = lifecycleTokenRef.current
    iceServersRef.current = []
    cleanupCall('idle')
    setError('')
    setSignalState('connecting')

    const previousSocket = socketRef.current
    socketRef.current = null
    if (previousSocket) {
      previousSocket.onclose = null
      previousSocket.close()
    }

    async function connectSignal() {
      try {
        const [signalResponse, iceResponse] = await Promise.all([
          fetch('/api/comms/audio-signal-ticket', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ conversationId: conversation.id }),
          }),
          fetch('/api/comms/ice-servers', {
            method: 'POST',
          }),
        ])
        const [signalPayload, icePayload] = await Promise.all([
          signalResponse.json(),
          iceResponse.json(),
        ])

        if (!signalResponse.ok) {
          throw new Error(signalPayload?.error || 'Audio signaling ticket failed.')
        }
        if (!iceResponse.ok) {
          throw new Error(icePayload?.error || 'Audio traversal is unavailable.')
        }
        if (!Array.isArray(icePayload?.iceServers) || !icePayload.iceServers.length) {
          throw new Error('Audio traversal is unavailable.')
        }
        if (disposed || lifecycleTokenRef.current !== lifecycleToken) return

        iceServersRef.current = icePayload.iceServers

        const separator = signalPayload.relayUrl.includes('?') ? '&' : '?'
        socket = new WebSocket(
          `${signalPayload.relayUrl}${separator}ticket=${encodeURIComponent(signalPayload.ticket)}`,
        )
        socketRef.current = socket

        socket.onopen = () => {
          if (
            disposed ||
            lifecycleTokenRef.current !== lifecycleToken ||
            socketRef.current !== socket
          ) return
          setSignalState('ready')
        }

        socket.onmessage = (event) => {
          if (disposed || socketRef.current !== socket) return
          void handleSignal(event)
        }

        socket.onclose = () => {
          if (disposed || intentionalClose || socketRef.current !== socket) return
          socketRef.current = null
          cleanupCall('idle')
          setSignalState('unavailable')
        }

        socket.onerror = () => {
          // onclose owns the user-visible failure state.
        }
      } catch (connectError) {
        if (disposed || lifecycleTokenRef.current !== lifecycleToken) return
        setError(connectError?.message || 'Audio signaling is unavailable.')
        setSignalState('unavailable')
      }
    }

    void connectSignal()

    return () => {
      disposed = true
      intentionalClose = true
      lifecycleTokenRef.current += 1
      iceServersRef.current = []

      sendActiveHangup()
      cleanupCall('idle')

      if (socketRef.current === socket) {
        socketRef.current = null
      }
      if (socket) {
        socket.onclose = null
        socket.close()
      }
    }
  }, [account?.id, conversation?.id, reconnectToken])

  async function startCall() {
    if (callStateRef.current !== 'idle' || signalState !== 'ready') return

    const callId = crypto.randomUUID()
    const lifecycleToken = lifecycleTokenRef.current
    setActiveCallId(callId)
    setCallState('inviting')
    setError('')

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      })

      if (
        lifecycleTokenRef.current !== lifecycleToken ||
        activeCallIdRef.current !== callId
      ) {
        for (const track of stream.getTracks()) {
          track.stop()
        }
        return
      }

      localStreamRef.current = stream

      if (!sendSignal('invite', callId)) {
        throw new Error('Audio signaling is unavailable.')
      }
    } catch (callError) {
      if (
        lifecycleTokenRef.current !== lifecycleToken ||
        activeCallIdRef.current !== callId
      ) {
        return
      }

      setError(callError?.message || 'Microphone access failed.')
      cleanupCall('idle')
    }
  }

  async function acceptCall() {
    const callId = activeCallIdRef.current
    if (!callId || callStateRef.current !== 'incoming') return

    const lifecycleToken = lifecycleTokenRef.current
    setError('')
    setCallState('connecting')
    setIncomingCallId('')

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      })

      if (
        lifecycleTokenRef.current !== lifecycleToken ||
        activeCallIdRef.current !== callId
      ) {
        for (const track of stream.getTracks()) {
          track.stop()
        }
        return
      }

      localStreamRef.current = stream
      createPeer(callId)

      if (!sendSignal('accept', callId)) {
        throw new Error('Audio signaling is unavailable.')
      }
    } catch (callError) {
      if (
        lifecycleTokenRef.current !== lifecycleToken ||
        activeCallIdRef.current !== callId
      ) {
        return
      }

      setError(callError?.message || 'Microphone access failed.')
      sendActiveHangup()
      cleanupCall('idle')
    }
  }

  function declineCall() {
    const callId = incomingCallId || activeCallIdRef.current
    if (!callId || callStateRef.current !== 'incoming') return

    sendSignal('decline', callId)
    cleanupCall('idle')
  }

  function hangUp() {
    const callId = activeCallIdRef.current
    if (!callId) return

    sendSignal('hangup', callId)
    cleanupCall('idle')
  }

  async function playAudio() {
    try {
      await audioRef.current?.play()
      setPlayBlocked(false)
    } catch {
      setPlayBlocked(true)
    }
  }

  function reconnectSignal() {
    cleanupCall('idle')
    setReconnectToken((value) => value + 1)
  }

  return (
    <div className="comms-audio-call" aria-label="Audio test call">
      <audio ref={audioRef} autoPlay />

      <div className="comms-audio-call-main">
        {callState === 'idle' && signalState === 'ready' && (
          <button type="button" onClick={startCall}>AUDIO TEST</button>
        )}

        {callState === 'inviting' && (
          <>
            <strong>CALLING…</strong>
            <button type="button" onClick={hangUp}>HANG UP</button>
          </>
        )}

        {callState === 'incoming' && (
          <>
            <strong>INCOMING AUDIO TEST</strong>
            <button type="button" onClick={acceptCall}>ACCEPT</button>
            <button type="button" onClick={declineCall}>DECLINE</button>
          </>
        )}

        {callState === 'connecting' && (
          <>
            <strong>CONNECTING AUDIO…</strong>
            <button type="button" onClick={hangUp}>HANG UP</button>
          </>
        )}

        {callState === 'connected' && (
          <>
            <strong>AUDIO CONNECTED</strong>
            <button type="button" onClick={hangUp}>HANG UP</button>
          </>
        )}

        {playBlocked && (
          <button type="button" onClick={playAudio}>PLAY AUDIO</button>
        )}

        {signalState === 'unavailable' && callState === 'idle' && (
          <button type="button" onClick={reconnectSignal}>RECONNECT SIGNAL</button>
        )}
      </div>

      {error && <small className="comms-audio-error">{error}</small>}
    </div>
  )
}
