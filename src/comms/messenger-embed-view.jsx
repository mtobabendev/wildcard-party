import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import Messenger from './Messenger.jsx'
import '../styles.css'

export function createMessengerRoot(node) {
  const root = createRoot(node)
  return {
    show(onStatus) { root.render(<StrictMode><Messenger embedded onStatus={onStatus} /></StrictMode>) },
    render() { root.render(null) },
    unmount() { root.unmount() },
  }
}
