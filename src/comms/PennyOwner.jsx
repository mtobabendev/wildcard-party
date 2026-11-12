import { useEffect, useState } from 'react'

async function request(view, signal) {
  const response = await fetch('/api/penny-owner?view=' + view, {
    credentials: 'same-origin', cache: 'no-store', signal,
  })
  if (response.status === 401 || response.status === 403) return null
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || 'Owner memory unavailable.')
  return data
}

export default function PennyOwner() {
  const [access, setAccess] = useState(null)
  const [records, setRecords] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [load, setLoad] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    request('status', controller.signal).then(data => {
      if (!controller.signal.aborted) setAccess(data)
    }).catch(() => {})
    return () => controller.abort()
  }, [])

  useEffect(() => {
    if (!load) return
    const controller = new AbortController()
    setBusy(true)
    setRecords(null)
    setError('')
    request('records', controller.signal).then(data => {
      if (controller.signal.aborted) return
      if (!data) {
        setAccess(null)
        return
      }
      setRecords(data.records)
    }).catch(err => {
      if (!controller.signal.aborted) setError(err.message)
    }).finally(() => {
      if (!controller.signal.aborted) setBusy(false)
    })
    return () => controller.abort()
  }, [load])

  if (!access?.owner) return null
  return <section aria-label="Owner project memory">
    <h2>♠ OWNER GATE</h2>
    <p>Read-only WildCard DEV project memory. Separate from your personal notes and conversation.</p>
    {!access.ready ? <p>Project memory is not enabled in this environment.</p> : <>
      <button type="button" disabled={busy} onClick={() => setLoad(value => value + 1)}>
        {busy ? 'Loading project memory…' : 'Load project memory'}
      </button>
      {error && <p role="alert">{error}</p>}
      {records?.map(record => <details key={record.kind + '/' + record.key}>
        <summary>{record.kind}/{record.key}</summary>
        {record.available ? <>
          <p>Updated: {record.createdAt}</p>
          <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify(record.payload, null, 2)}</pre>
        </> : <p>No approved record found.</p>}
      </details>)}
    </>}
  </section>
}
