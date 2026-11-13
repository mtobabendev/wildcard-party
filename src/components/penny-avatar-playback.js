// The caller mounts this controller only during an active Penny interaction.
export function bindAvatarPlayback(video, src, page, motion) {
  let attached = false
  let disposed = false

  function release() {
    video.pause()
    if (attached) {
      attached = false
      video.removeAttribute('src')
      video.load()
    }
  }

  function sync() {
    if (disposed) return
    if (page.hidden || motion.matches) {
      release()
      return
    }
    if (!attached) {
      video.muted = true
      video.src = src
      attached = true
    }
    // A blocked autoplay leaves the static poster available.
    video.play()?.catch(() => {})
  }

  function onError() {
    if (attached) release()
  }

  page.addEventListener('visibilitychange', sync)
  if (motion.addEventListener) motion.addEventListener('change', sync)
  else motion.addListener?.(sync)
  video.addEventListener('error', onError)
  sync()

  return () => {
    disposed = true
    page.removeEventListener('visibilitychange', sync)
    if (motion.removeEventListener) motion.removeEventListener('change', sync)
    else motion.removeListener?.(sync)
    video.removeEventListener('error', onError)
    release()
  }
}
