import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { Script, createContext } from 'node:vm'

const script = readFileSync(new URL('../public/static/wildcard-spade-loader.js', import.meta.url), 'utf8')

function environment({ autostart = false, readyState = 'complete' } = {}) {
  const timers = new Map()
  let timerId = 0
  let activeObserver = null
  const createElement = () => {
    const attrs = new Map()
    const toggles = new Map()
    const listeners = new Map()
    return {
      attributes: attrs, style: {}, hidden: false, children: [],
      classList: { toggle(k, value) { toggles.set(k, value) }, has(k) { return toggles.get(k) } },
      setAttribute(k, v) { attrs.set(k, v) },
      getAttribute(k) { return attrs.get(k) ?? null },
      removeAttribute(k) { attrs.delete(k) },
      addEventListener(k, fn) { listeners.set(k, fn) },
      appendChild(child) { this.children.push(child) },
      click() { listeners.get('click')?.() },
    }
  }
  const root = createElement()
  const spades = Array.from({ length: 5 }, createElement)
  const fields = {
    '.wcdl__track': createElement(),
    '.wcdl__fill': createElement(),
    '.wcdl__label': createElement(),
    '.wcdl__percent': createElement(),
    '.wcdl__close': createElement(),
  }
  let shell = null
  const doc = {
    currentScript: { hasAttribute: value => autostart && value === 'data-wcd-autostart' },
    readyState,
    head: { appendChild() {} },
    body: { appendChild(element) { shell = element } },
    getElementById(value) { return value === 'root' ? root : null },
    createElement(tag) {
      const el = createElement()
      if (tag === 'section') {
        el.querySelectorAll = selector => selector === '.wcdl__spade' ? spades : []
        el.querySelector = selector => fields[selector] || null
      }
      return el
    },
    addEventListener() {},
  }
  const win = {
    setTimeout(fn, ms) { const id = ++timerId; timers.set(id, { fn, ms }); return id },
    clearTimeout(id) { timers.delete(id) },
    requestAnimationFrame(fn) { fn() },
    addEventListener() {},
  }
  class FakeObserver {
    constructor(fn) { activeObserver = { fn, disconnected: false } }
    observe() {}
    disconnect() { activeObserver.disconnected = true }
  }
  new Script(script, { filename: 'wildcard-spade-loader.js' })
    .runInContext(createContext({ window: win, document: doc, MutationObserver: FakeObserver }))
  return {
    api: win.WildCardLoader, root, spades, fields,
    get shell() { return shell },
    flush(ms = 200) {
      const eligible = [...timers.entries()].filter(([, timer]) => timer.ms <= ms)
      for (const [id, timer] of eligible) {
        timers.delete(id)
        timer.fn()
      }
    },
    completeBoot() {
      root.children.push(createElement())
      activeObserver?.fn()
      assert.equal(activeObserver?.disconnected, true)
    },
  }
}

test('global API loads without dependencies, shows five accessible spades, and hides safely', () => {
  const e = environment()
  assert.ok(e.api)
  const id = e.api.show({ label: 'Checking Penny access…' })
  assert.equal(e.api.isActive(), true)
  e.flush()
  assert.equal(e.shell.hidden, false)
  assert.equal(e.fields['.wcdl__label'].textContent, 'Checking Penny access…')
  assert.equal(e.fields['.wcdl__track'].getAttribute('aria-valuenow'), null)
  assert.equal(e.spades.length, 5)
  assert.equal(e.root.getAttribute('aria-busy'), 'true')
  e.api.hide(id)
  assert.equal(e.shell.hidden, true)
  assert.equal(e.root.getAttribute('aria-busy'), null)
  assert.equal(e.api.isActive(), false)
})

test('determinate progress uses supplied percentages and fills one spade per 20%', () => {
  const e = environment()
  const id = e.api.begin({ label: 'File transfer', progress: 0 })
  e.flush()
  assert.equal(e.fields['.wcdl__track'].getAttribute('aria-valuenow'), '0')
  assert.equal(e.api.update(id, 64, 'Step three'), true)
  assert.equal(e.fields['.wcdl__fill'].style.width, '64%')
  assert.equal(e.fields['.wcdl__label'].textContent, 'Step three')
  assert.deepEqual(e.spades.map(s => s.getAttribute('data-filled')), ['true','true','true','false','false'])
  e.api.update(id, 999)
  assert.equal(e.fields['.wcdl__fill'].style.width, '100%')
  assert.equal(e.fields['.wcdl__track'].getAttribute('aria-valuenow'), '100')
  e.api.update(id, -5)
  assert.equal(e.fields['.wcdl__fill'].style.width, '0%')
  e.api.update(id, undefined)
  assert.equal(e.fields['.wcdl__track'].getAttribute('aria-valuenow'), null)
  e.api.end(id)
})

test('multiple pending jobs do not dismiss each other, and manual dismiss works', () => {
  const e = environment()
  const one = e.api.show('First')
  const two = e.api.show('Second')
  e.flush()
  assert.equal(e.fields['.wcdl__label'].textContent, 'Second')
  e.api.hide(two)
  assert.equal(e.api.isActive(), true)
  assert.equal(e.fields['.wcdl__label'].textContent, 'First')
  e.fields['.wcdl__close'].click()
  assert.equal(e.api.isActive(), false)
  assert.equal(e.shell.hidden, true)
  assert.equal(e.api.update(one, 50), false)
})

test('promise wrapper clears on fulfillment and rejection', async () => {
  const e = environment()
  const value = await e.api.track(Promise.resolve('done'), { label: 'Signing in…' })
  assert.equal(value, 'done')
  assert.equal(e.api.isActive(), false)
  await assert.rejects(e.api.track(Promise.reject(new Error('expected')), { label: 'Saving…' }), /expected/)
  assert.equal(e.api.isActive(), false)
})

test('startup auto loader only stays active until root first renders', () => {
  const e = environment({ autostart: true })
  assert.equal(e.api.isActive(), true)
  e.flush()
  assert.equal(e.shell.hidden, false)
  e.completeBoot()
  assert.equal(e.api.isActive(), false)
  assert.equal(e.shell.hidden, true)
  e.flush(12000)
  assert.equal(e.api.isActive(), false)
})

test('stylesheet honors reduced motion and does not fake percentage in busy mode', () => {
  assert.match(script, /prefers-reduced-motion:reduce/)
  assert.match(script, /aria-valuemin="0" aria-valuemax="100"/)
  assert.match(script, /Number\.isFinite\(progress\)/)
  assert.match(script, /Number\.isFinite\(options\.progress\)/)
  assert.match(script, /textContent = latest\.label/)
})
