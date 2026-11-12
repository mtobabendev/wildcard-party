import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import './styles.css'

const Messenger = lazy(() => import('./comms/Messenger.jsx'))
const isMessenger = window.location.pathname.replace(/\/+$/, '') === '/messenger'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {isMessenger ? <Suspense fallback={<p>Opening Messenger…</p>}><Messenger /></Suspense> : <App />}
  </StrictMode>,
)
