import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import MemberArea from './MemberArea.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode><MemberArea /></StrictMode>,
)
