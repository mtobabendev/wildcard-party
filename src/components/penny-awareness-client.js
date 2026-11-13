import { useEffect, useState } from 'react'
import { CITIES, SIGNS, horoscope } from './penny-awareness-data.js'

const PREF = 'wildcard:awareness:v1'
const REFRESH = {weather:900000,alerts:300000,news:900000}
const memory = new Map()
function loadPrefs() {
  try {
    const p=JSON.parse(localStorage.getItem(PREF)||'{}')
    return {city:Object.hasOwn(CITIES,p?.city)?p.city:'omaha',sign:SIGNS.includes(p?.sign)?p.sign:'Scorpio'}
  } catch {return {city:'omaha',sign:'Scorpio'}}
}
function fresh(card,now) {return card&&typeof card.text==='string'&&Number.isFinite(Date.parse(card.expiresAt))&&Date.parse(card.expiresAt)>now}
function read(key) {
  const entry=memory.get(key)
  return entry?.cards||[]
}
export function usePennyAwareness(endpoint,clock) {
  const [prefs,setPrefs]=useState(loadPrefs)
  const [data,setData]=useState({weather:[],alerts:[],news:[]})
  function choose(key,value) {
    setPrefs(prev=>{const next={...prev,[key]:value};try{localStorage.setItem(PREF,JSON.stringify(next))}catch{}return next})
  }
  useEffect(()=>{
    let disposed=false
    const controllers=new Set(),busy=new Set(),timers=[]
    const keys=Object.fromEntries(Object.keys(REFRESH).map(kind=>[kind,endpoint+'?kind='+kind+(kind==='news'?'':'&city='+encodeURIComponent(prefs.city))]))
    const update=(kind,cards)=>{if(!disposed)setData(old=>({...old,[kind]:cards}))}
    setData(Object.fromEntries(Object.keys(REFRESH).map(kind=>[kind,read(keys[kind])])))
    async function refresh(kind) {
      if(disposed||document.hidden||busy.has(kind))return
      const key=keys[kind],cached=memory.get(key)
      if(cached&&Date.now()-cached.at<REFRESH[kind]){update(kind,cached.cards);return}
      const controller=new AbortController();controllers.add(controller);busy.add(kind)
      try {
        const res=await fetch(key,{credentials:'omit',signal:controller.signal})
        if(!res.ok)throw Error('unavailable')
        const result=await res.json()
        if(result.kind!==kind||!Array.isArray(result.cards))throw Error('invalid response')
        const cards=result.cards.filter(c=>fresh(c,Date.now())).slice(0,5)
        if(!disposed&&!controller.signal.aborted){memory.set(key,{at:Date.now(),cards});update(kind,cards)}
      }catch{if(!controller.signal.aborted)update(kind,[])}
      finally{controllers.delete(controller);busy.delete(kind)}
    }
    function visible() {
      if(document.hidden){for(const c of controllers)c.abort()}
      else for(const kind of Object.keys(REFRESH))refresh(kind)
    }
    for(const kind of Object.keys(REFRESH)){refresh(kind);timers.push(window.setInterval(()=>refresh(kind),REFRESH[kind]))}
    document.addEventListener('visibilitychange',visible)
    return ()=>{disposed=true;for(const c of controllers)c.abort();for(const timer of timers)clearInterval(timer);document.removeEventListener('visibilitychange',visible)}
  },[endpoint,prefs.city])
  const now=clock.getTime()
  const matching=c=>c.label.endsWith(CITIES[prefs.city].label)
  return {prefs,choose,alerts:data.alerts.filter(c=>fresh(c,now)&&matching(c)),cards:[...data.weather.filter(c=>fresh(c,now)&&matching(c)),...data.news.filter(c=>fresh(c,now)),horoscope(prefs.sign,clock)]}
}
