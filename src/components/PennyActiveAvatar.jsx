import { useEffect, useRef } from 'react'
import { bindAvatarPlayback } from './penny-avatar-playback.js'
import './PennyActiveAvatar.css'

export const PENNY_AVATAR_POSTER = '/assets/penny/card-art/PennyFBProfilePic1-poster.webp'
const PENNY_AVATAR_VIDEO = '/assets/penny/card-art/PennyFBProfilePic1.webm'

export default function PennyActiveAvatar() {
  const videoRef = useRef(null)
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    return bindAvatarPlayback(video, PENNY_AVATAR_VIDEO, document,
      window.matchMedia('(prefers-reduced-motion: reduce)'))
  }, [])
  return <video ref={videoRef} className="penny-active-avatar" poster={PENNY_AVATAR_POSTER}
    muted loop playsInline preload="none" disablePictureInPicture aria-hidden="true" />
}
