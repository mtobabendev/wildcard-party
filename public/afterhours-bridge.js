const permittedParents = new Set(['https://wildcarddev.com', 'https://www.wildcarddev.com'])
const params = new URLSearchParams(location.search)
const parentOrigin = params.get('parent')
const area = params.get('area')

if (!permittedParents.has(parentOrigin) || !['penny', 'kandy', 'ashley'].includes(area)) {
  document.body.textContent = 'Access bridge unavailable.'
} else {
  let running = false
  async function verify() {
    if (running) return
    running = true
    let result = { type: 'wildcard:afterhours:access:v1', area, allowed: false, status: 503 }
    try {
      const response = await fetch('/api/afterhours/access?area=' + encodeURIComponent(area), {
        credentials: 'same-origin', cache: 'no-store',
      })
      const data = await response.json().catch(() => ({}))
      result = {
        ...result,
        allowed: response.ok && data.allowed === true,
        status: response.status,
      }
    } catch { /* Network or backend failures never unlock the page. */ }
    window.parent.postMessage(result, parentOrigin)
    running = false
  }

  window.addEventListener('message', event => {
    if (event.source === window.parent && event.origin === parentOrigin &&
        event.data?.type === 'wildcard:afterhours:verify:v1' && event.data?.area === area) {
      void verify()
    }
  })
  void verify()
}
