import { useEffect, useState } from 'react'
import './PennyPixelAvatar.css'

const GIF = 'https://www.wildcarddev.com/static/Penny.gif'

// The original animated avatar is independent of the nurse video lifecycle.
export default function PennyPixelAvatar() {
  const [animate, setAnimate] = useState(() =>
    !document.hidden && !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
  useEffect(() => {
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => setAnimate(!document.hidden && !motion.matches)
    document.addEventListener('visibilitychange', sync)
    if (motion.addEventListener) motion.addEventListener('change', sync)
    else motion.addListener?.(sync)
    sync()
    return () => {
      document.removeEventListener('visibilitychange', sync)
      if (motion.removeEventListener) motion.removeEventListener('change', sync)
      else motion.removeListener?.(sync)
    }
  }, [])
  return animate
    ? <img className="penny-pixel-avatar" src={GIF} referrerPolicy="no-referrer" alt="" decoding="async" aria-hidden="true" />
    : <span className="penny-pixel-avatar penny-pixel-avatar--still" aria-hidden="true">♠</span>
}
