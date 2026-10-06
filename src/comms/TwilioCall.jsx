import { useEffect, useRef, useState } from 'react'
import { connect } from 'twilio-video'

const CALL_POLL_MS = 2000

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    cache: 'no-store',
  })
  const payload = await response.json().catch(() => ({}))

  if (!response.ok) {
    const error = new Error(payload?.error || 'Call request failed.')
    error.status = response.status
    throw error
  }

  return payload
}

export default function TwilioCall({ account, conversation }) {
  const [call, setCall] = useState(null)
  const [phase, setPhase] = useState('idle')
  const [error, setError] = useState('')
  const [muted, setMuted] = useState(false)
  const [cameraEnabled, setCameraEnabled] = useState(true)

  const roomRef = useRef(null)
  const callRef = useRef(null)
  const connectingCallIdRef = useRef('')
  const intentionalDisconnectRef = useRef(false)
  const attachedRemoteTracksRef = useRef(new Set())
  const remoteMediaRef = useRef(null)
  const localVideoRef = useRef(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    callRef.current = call
  }, [call])

  useEffect(() => () => {
    mountedRef.current = false
    disconnectRoom()
  }, [])

  useEffect(() => {
    disconnectRoom()
    setCall(null)
    setPhase('idle')
    setError('')
    setMuted(false)
    setCameraEnabled(true)

    if (!account?.id || !conversation?.id) return undefined

    let timer = null
    let disposed = false

    async function refresh() {
      if (disposed || document.hidden) return

      try {
        const payload = await requestJson(
          `/api/comms/calls?conversationId=${encodeURIComponent(conversation.id)}`,
        )
        if (disposed) return

        const nextCall = payload.call || null
        setCall(nextCall)

        if (!nextCall && roomRef.current) {
          disconnectRoom()
        }
      } catch (requestError) {
        if (!disposed) {
          setError(requestError?.message || 'Call state could not be checked.')
        }
      }
    }

    function startPolling() {
      if (timer) window.clearInterval(timer)
      timer = null
      if (document.hidden) return

      refresh()
      timer = window.setInterval(refresh, CALL_POLL_MS)
    }

    function handleVisibility() {
      startPolling()
    }

    startPolling()
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      disposed = true
      document.removeEventListener('visibilitychange', handleVisibility)
      if (timer) window.clearInterval(timer)
    }
  }, [account?.id, conversation?.id])

  useEffect(() => {
    if (call?.status === 'accepted' && !roomRef.current) {
      connectAcceptedCall(call)
      return
    }

    if ((!call || call.status !== 'accepted') && roomRef.current) {
      disconnectRoom()
    }
  }, [call?.id, call?.status, call?.mode])

  function removeAttachedElements(track) {
    try {
      for (const element of track.detach()) {
        element.remove()
      }
    } catch {
      // The track may already be detached.
    }
  }

  function attachRemoteTrack(track) {
    if (!track || !['audio', 'video'].includes(track.kind)) return
    if (attachedRemoteTracksRef.current.has(track.sid)) return

    const container = remoteMediaRef.current
    if (!container) return

    const element = track.attach()
    if (track.kind === 'video') {
      element.playsInline = true
      element.autoplay = true
    }
    if (track.kind === 'audio') {
      element.autoplay = true
    }

    container.appendChild(element)
    attachedRemoteTracksRef.current.add(track.sid)
  }

  function detachRemoteTrack(track) {
    if (!track) return
    removeAttachedElements(track)
    attachedRemoteTracksRef.current.delete(track.sid)
  }

  function wireRemoteParticipant(participant) {
    participant.tracks.forEach((publication) => {
      if (publication.isSubscribed && publication.track) {
        attachRemoteTrack(publication.track)
      }
    })

    participant.on('trackSubscribed', attachRemoteTrack)
    participant.on('trackUnsubscribed', detachRemoteTrack)
  }

  function unwireRemoteParticipant(participant) {
    participant.tracks.forEach((publication) => {
      if (publication.track) detachRemoteTrack(publication.track)
    })
  }

  function cleanupRoomMedia(room) {
    if (!room) return

    room.localParticipant.tracks.forEach((publication) => {
      const track = publication.track
      if (!track) return
      removeAttachedElements(track)
      if (typeof track.stop === 'function') track.stop()
    })

    room.participants.forEach(unwireRemoteParticipant)
    attachedRemoteTracksRef.current.clear()

    if (remoteMediaRef.current) {
      remoteMediaRef.current.replaceChildren()
    }
  }

  function disconnectRoom() {
    const room = roomRef.current
    connectingCallIdRef.current = ''

    if (!room) return

    intentionalDisconnectRef.current = true
    roomRef.current = null

    try {
      room.disconnect()
    } catch {
      cleanupRoomMedia(room)
      intentionalDisconnectRef.current = false
    }

    if (mountedRef.current) {
      setPhase('idle')
      setMuted(false)
      setCameraEnabled(true)
    }
  }

  async function endCallAfterFailure(callId) {
    try {
      await requestJson('/api/comms/calls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'end', callId }),
      })
    } catch {
      // The direct Twilio error is already surfaced inline.
    }
  }

  async function connectAcceptedCall(acceptedCall) {
    if (
      !acceptedCall?.id ||
      connectingCallIdRef.current === acceptedCall.id ||
      roomRef.current
    ) {
      return
    }

    connectingCallIdRef.current = acceptedCall.id
    setPhase('connecting')
    setError('')
    setMuted(false)
    setCameraEnabled(true)

    try {
      const tokenPayload = await requestJson('/api/comms/video-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callId: acceptedCall.id }),
      })

      if (callRef.current?.id !== acceptedCall.id || callRef.current?.status !== 'accepted') {
        connectingCallIdRef.current = ''
        return
      }

      const room = await connect(tokenPayload.token, {
        name: tokenPayload.roomName,
        audio: true,
        video: acceptedCall.mode === 'video',
      })

      if (
        !mountedRef.current ||
        callRef.current?.id !== acceptedCall.id ||
        callRef.current?.status !== 'accepted'
      ) {
        cleanupRoomMedia(room)
        room.disconnect()
        connectingCallIdRef.current = ''
        return
      }

      roomRef.current = room
      connectingCallIdRef.current = ''

      room.participants.forEach(wireRemoteParticipant)
      room.on('participantConnected', wireRemoteParticipant)
      room.on('participantDisconnected', unwireRemoteParticipant)

      if (acceptedCall.mode === 'video' && localVideoRef.current) {
        room.localParticipant.videoTracks.forEach((publication) => {
          publication.track?.attach(localVideoRef.current)
        })
      }

      room.once('disconnected', (disconnectedRoom, disconnectError) => {
        const intentional = intentionalDisconnectRef.current
        intentionalDisconnectRef.current = false

        if (roomRef.current === disconnectedRoom) {
          roomRef.current = null
        }

        cleanupRoomMedia(disconnectedRoom)
        connectingCallIdRef.current = ''

        if (!mountedRef.current) return

        setPhase('idle')
        setMuted(false)
        setCameraEnabled(true)

        if (!intentional) {
          setError(disconnectError?.message || 'Twilio disconnected the call.')
          setCall(null)
          endCallAfterFailure(acceptedCall.id)
        }
      })

      setPhase('connected')
    } catch (connectError) {
      connectingCallIdRef.current = ''
      if (!mountedRef.current) return

      setError(connectError?.message || 'Twilio could not connect the call.')
      setPhase('idle')
      setCall(null)
      await endCallAfterFailure(acceptedCall.id)
    }
  }

  async function postCallAction(action, extra = {}) {
    setError('')

    try {
      const payload = await requestJson('/api/comms/calls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...extra }),
      })
      setCall(payload.call || null)
      return payload.call || null
    } catch (requestError) {
      setError(requestError?.message || 'Call action failed.')
      return null
    }
  }

  async function startCall(mode) {
    if (!conversation?.id) return
    await postCallAction('start', {
      conversationId: conversation.id,
      mode,
    })
  }

  async function acceptCall() {
    if (!call?.id) return
    await postCallAction('accept', { callId: call.id })
  }

  async function declineCall() {
    if (!call?.id) return
    await postCallAction('decline', { callId: call.id })
    setCall(null)
  }

  async function hangUp() {
    if (!call?.id) return
    const callId = call.id
    await postCallAction('end', { callId })
    disconnectRoom()
    setCall(null)
  }

  function toggleMute() {
    const room = roomRef.current
    if (!room) return

    const nextMuted = !muted
    room.localParticipant.audioTracks.forEach((publication) => {
      if (!publication.track) return
      if (nextMuted) publication.track.disable()
      else publication.track.enable()
    })
    setMuted(nextMuted)
  }

  function toggleCamera() {
    const room = roomRef.current
    if (!room || call?.mode !== 'video') return

    const nextEnabled = !cameraEnabled
    room.localParticipant.videoTracks.forEach((publication) => {
      if (!publication.track) return
      if (nextEnabled) publication.track.enable()
      else publication.track.disable()
    })
    setCameraEnabled(nextEnabled)
  }

  const outgoing = call?.callerAccountId === account?.id
  const otherHandle = conversation?.otherAccount?.handle || 'account'
  const accepted = call?.status === 'accepted'
  const videoMode = call?.mode === 'video'

  return (
    <section className="comms-call" aria-label="Conversation call controls">
      {error && <p className="comms-call-error">{error}</p>}

      {!call && (
        <div className="comms-call-actions">
          <button type="button" onClick={() => startCall('audio')}>
            AUDIO CALL
          </button>
          <button type="button" onClick={() => startCall('video')}>
            VIDEO CALL
          </button>
        </div>
      )}

      {call?.status === 'ringing' && outgoing && (
        <div className="comms-call-state">
          <strong>CALLING @{otherHandle}…</strong>
          <button type="button" onClick={hangUp}>HANG UP</button>
        </div>
      )}

      {call?.status === 'ringing' && !outgoing && (
        <div className="comms-call-state">
          <strong>INCOMING {videoMode ? 'VIDEO' : 'AUDIO'} CALL</strong>
          <div>
            <button type="button" onClick={acceptCall}>ACCEPT</button>
            <button type="button" onClick={declineCall}>DECLINE</button>
          </div>
        </div>
      )}

      {accepted && (
        <div className="comms-call-active">
          <div className="comms-call-state">
            <strong>
              {phase === 'connected'
                ? `${videoMode ? 'VIDEO' : 'AUDIO'} CONNECTED`
                : `CONNECTING ${videoMode ? 'VIDEO' : 'AUDIO'}…`}
            </strong>
            <div>
              <button type="button" onClick={toggleMute} disabled={phase !== 'connected'}>
                {muted ? 'UNMUTE' : 'MUTE'}
              </button>
              {videoMode && (
                <button type="button" onClick={toggleCamera} disabled={phase !== 'connected'}>
                  {cameraEnabled ? 'CAMERA OFF' : 'CAMERA ON'}
                </button>
              )}
              <button type="button" onClick={hangUp}>HANG UP</button>
            </div>
          </div>

          {videoMode && (
            <div className="comms-call-video-grid">
              <div>
                <small>YOU</small>
                <video ref={localVideoRef} autoPlay muted playsInline />
              </div>
              <div>
                <small>@{otherHandle}</small>
                <div ref={remoteMediaRef} className="comms-call-remote-media" />
              </div>
            </div>
          )}

          {!videoMode && (
            <div ref={remoteMediaRef} className="comms-call-remote-media comms-call-audio-media" />
          )}
        </div>
      )}
    </section>
  )
}
