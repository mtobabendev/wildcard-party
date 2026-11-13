import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import './styles.css'

const Messenger = lazy(() => import('./comms/Messenger.jsx'))
const isMessenger = new URLSearchParams(window.location.search).get('app') === 'messenger'

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
    ) : <App />}
  </StrictMode>,
)
