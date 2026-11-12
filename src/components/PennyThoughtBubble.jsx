import { useEffect, useId, useRef, useState } from 'react'
import './PennyThoughtBubble.css'

const greetings = [
  ['Good morning', 'Coffee first, world domination second.', 'Coffee, darling?'],
  ['Good afternoon', 'What are we building today?', 'The afternoon looks promising.'],
  ['Good evening', 'Let’s make something remarkable.', 'The evening is just getting interesting.'],
  ['You’re up late', 'The workshop never sleeps.', 'The night has excellent company.'],
]
const quips = [
  ['One brilliant idea at a time.', 'A little magic, a lot of engineering.'],
  ['The best solutions have fewer moving parts.', 'Let’s put that imagination to work.'],
  ['Neon lights and bright ideas.', 'The next great idea might be yours.'],
  ['Even the moon has a night shift.', 'Quiet hours, loud ideas.'],
]
function getPeriod(hour) {
  return hour >= 5 && hour < 12 ? 0 : hour >= 12 && hour < 17 ? 1 : hour >= 17 && hour < 22 ? 2 : 3
}
export default function PennyThoughtBubble({ provider = 'gemini', placement = 'main' }) {
  const [clock, setClock] = useState(() => new Date())
  const [quipIndex, setQuipIndex] = useState(0)
  const dialog = useRef(null)
  const trigger = useRef(null)
  const titleId = useId()
  const period = getPeriod(clock.getHours())
  const afterHours = placement === 'after-hours'
  const name = provider === 'grok' ? 'Grok' : 'Gemini'
  const greeting = greetings[period][0]
  const quip = quipIndex % 3 === 0 ? greetings[period][afterHours ? 2 : 1] : quips[period][(quipIndex - 1) % 2]
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!document.hidden) { setClock(new Date()); setQuipIndex(value => value + 1) }
    }, 60000)
    const onVisible = () => { if (!document.hidden) setClock(new Date()) }
    document.addEventListener('visibilitychange', onVisible)
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisible) }
  }, [])
  function open() {
    setClock(new Date())
    dialog.current?.showModal()
  }
  return (
    <div className={'penny-thought penny-thought--' + placement}>
      <button ref={trigger} type="button" className="penny-thought__bubble" onClick={open} aria-haspopup="dialog" aria-label={greeting + '. Talk to Penny'}>
        <span className="penny-thought__greeting">{greeting} ♠</span>
        <span className="penny-thought__quip">{quip}</span>
        <span className="penny-thought__hint">Talk to Penny</span>
      </button>
      <dialog ref={dialog} className="penny-thought__dialog" aria-labelledby={titleId} onClose={() => trigger.current?.focus()}>
        <div className="penny-thought__header">
          <h2 id={titleId}>♠ Penny · {name}</h2>
          <button type="button" onClick={() => dialog.current?.close()} aria-label="Close conversation">×</button>
        </div>
        <p>{greeting}! {quip}</p>
        <p className="penny-thought__status">Live {name} conversation and local weather are not connected yet. This greeting runs on your device.</p>
        <a href="https://party.wildcarddev.com/?app=messenger" target="_blank" rel="noopener noreferrer">Open WildCard Messenger</a>
      </dialog>
    </div>
  )
}
