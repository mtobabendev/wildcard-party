import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import './styles.css'

const Messenger = lazy(() => import('./comms/Messenger.jsx'))
const OwnerAccess = lazy(() => import('./afterhours/OwnerAccess.jsx'))
const app = new URLSearchParams(window.location.search).get('app')
const isMessenger = app === 'messenger'
const isAccessAdmin = app === 'afterhours-admin'

// The existing public Party dock stays intact; Messenger gets the shared concierge.
if (isMessenger) {
  const concierge = document.createElement('script')
  concierge.src = 'https://www.wildcarddev.com/static/ask-penny.js'
  concierge.async = true
  document.body.append(concierge)
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {isMessenger ? (
      <Suspense fallback={<main className="page-shell">Opening WildCard Messenger…</main>}>
        <Messenger />
      </Suspense>
    ) : isAccessAdmin ? (
      <Suspense fallback={<main className="page-shell">Opening Owner Gate…</main>}>
        <OwnerAccess />
      </Suspense>
    ) : <App />}
  </StrictMode>,
)
