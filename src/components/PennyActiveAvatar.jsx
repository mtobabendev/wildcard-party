import { useEffect, useRef } from 'react'
import { bindAvatarPlayback } from './penny-avatar-playback.js'
import './PennyActiveAvatar.css'

export const PENNY_AVATAR_POSTER = '/assets/penny/card-art/PennyFBProfilePic1-poster.webp'
const PENNY_AVATAR_VIDEO = '/assets/penny/card-art/PennyFBProfilePic1.webm'

export default function PennyActiveAvatar({ videoSource = PENNY_AVATAR_VIDEO, poster = PENNY_AVATAR_POSTER } = {}) {
  const videoRef = useRef(null)
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    return bindAvatarPlayback(video, videoSource, document,
      window.matchMedia('(prefers-reduced-motion: reduce)'))
  }, [videoSource])
  return <video ref={videoRef} className="penny-active-avatar" poster={poster}
    muted loop playsInline preload="none" disablePictureInPicture aria-hidden="true" />
}
