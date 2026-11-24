import { useState } from 'react'
import OwnerContentEditor from './OwnerContentEditor.jsx'
import { createCollectionName } from './mediaCollections.js'

const AREAS = ['penny', 'kandy', 'ashley']
const TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/webm'])
const MAX_BYTES = 150 * 1024 * 1024
const RELAY_MAX_BYTES = 2 * 1024 * 1024

function fileBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Could not read selected file.'))
    reader.onabort = () => reject(new Error('File read cancelled.'))
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '')
    reader.readAsDataURL(file)
  })
}

async function api(body) {
  const response = await fetch('/api/afterhours/media-admin', {
    method: 'POST', credentials: 'same-origin', cache: 'no-store',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || 'Media service unavailable.')
  return data
}

async function importApi(body) {
  const response = await fetch('/api/afterhours/import-legacy', {
    method: 'POST', credentials: 'same-origin', cache: 'no-store',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || 'Private import unavailable.')
  return data
}

export default function OwnerMedia() {
  const [area, setArea] = useState('penny')
  const [mediaRevision, setMediaRevision] = useState(0)
  const [files, setFiles] = useState([])
  const [fileNames, setFileNames] = useState([])
  const [collection, setCollection] = useState('')
  const [busy, setBusy] = useState(false)
  const [results, setResults] = useState([])
  const [progress, setProgress] = useState('')
  const [message, setMessage] = useState('')
  const [pairingToken, setPairingToken] = useState('')
  const [pairingBusy, setPairingBusy] = useState(false)
  const [pairingStatus, setPairingStatus] = useState('')

  async function upload(event) {
    event.preventDefault()
    if (!files.length || busy) return
    setBusy(true)
    setMessage('')
    const next = []
    const failed = []
    const failedNames = []
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        const chosenName = (fileNames[i] || '').trim()
        const name = createCollectionName(chosenName, collection)
        setProgress((i + 1) + '/' + files.length + ': ' + chosenName)
        try {
          if (!chosenName || !/^[^\\/\\\\\x00-\x1f\x7f]+$/.test(chosenName) || chosenName.length > 180 || !/\.(jpg|jpeg|png|webp|gif|mp4|webm)$/i.test(chosenName)) {
            throw new Error('Enter a valid stored filename with its extension.')
          }
          if (!TYPES.has(file.type) || file.size < 1 || file.size > MAX_BYTES) {
            throw new Error('Unsupported file type or file exceeds 150 MB.')
          }
          const existing = await api({ action: 'check', area, name })
          if (existing.exists) {
            next.push({ name: name || chosenName || file.name, status: 'Skipped (already exists)' })
          } else if (file.size <= RELAY_MAX_BYTES) {
            const result = await api({ action: 'relay', area, name, contentType: file.type, byteSize: file.size, base64: await fileBase64(file) })
            if (result.ok !== true) throw new Error('Upload not verified.')
            next.push({ name, status: 'Uploaded' })
          } else {
          const { upload: ticket } = await api({
            action: 'start', area, name, contentType: file.type, byteSize: file.size,
          })
          const sent = await fetch(ticket.uploadUrl, {
            method: 'PUT', headers: { 'Content-Type': ticket.contentType }, body: file,
          })
          if (!sent.ok) throw new Error('Storage rejected upload (' + sent.status + ').')
          const finished = await api({ action: 'finish', id: ticket.id })
          if (finished.ok !== true) throw new Error('Upload not verified.')
          next.push({ name: name || chosenName || file.name, status: 'Uploaded' })
          }
        } catch (error) {
          next.push({ name: name || chosenName || file.name, status: 'Failed: ' + error.message })
          failed.push(file)
          failedNames.push(chosenName)
        }
        setResults([...next])
      }
      const uploaded = next.filter(item => item.status === 'Uploaded').length
      const skipped = next.filter(item => item.status.startsWith('Skipped')).length
      setMessage(uploaded + ' uploaded, ' + skipped + ' already present, ' + failed.length + ' failed.')
      setFiles(failed)
      setFileNames(failedNames)
      if (uploaded || skipped) setMediaRevision(value => value + 1)
    } finally {
      setBusy(false)
      setProgress('')
    }
  }

  async function pairWorkstation() {
    setPairingBusy(true)
    try {
      const { pairing } = await api({ action: 'pair' })
      if (!pairing?.token) throw new Error('Pairing token not returned.')
      setPairingToken(pairing.token)
      setPairingStatus('Key created. Keep it private; pairing is optional for browser uploads.')
    } catch (error) { setPairingStatus('Pairing failed: ' + error.message) }
    finally { setPairingBusy(false) }
  }

  async function revokePairings() {
    if (!window.confirm('Revoke all workstation upload keys? Browser uploads remain available.')) return
    setPairingBusy(true)
    try {
      const result = await api({ action: 'revoke-pairings' })
      setPairingToken('')
      setPairingStatus((result.revoked || 0) + ' workstation keys revoked.')
    } catch (error) { setPairingStatus('Revocation failed: ' + error.message) }
    finally { setPairingBusy(false) }
  }

  async function importExistingPennyMedia() {
    if (busy) return
    setBusy(true)
    setMessage('Checking private bucket permissions...')
    try {
      const privacy = await importApi({ action: 'probe' })
      if (privacy.privateBucket !== true) throw new Error('Destination bucket not verified private.')
      const initial = await importApi({ action: 'status' })
      if (initial.total !== 39 || !Array.isArray(initial.missing)) throw new Error('Expected inventory unavailable.')
      let completed = initial.ready
      for (const name of initial.missing) {
        setMessage('Copying ' + name + ' (' + completed + '/39)...')
        await importApi({ action: 'import', name })
        completed++
      }
      const final = await importApi({ action: 'status' })
      if (final.ready !== 39 || final.missing.length) throw new Error('Import incomplete; retry to resume.')
      setMessage('All 39 Penny media items verified in the private vault. Public URLs are unchanged.')
    } catch (error) { setMessage('Import stopped: ' + error.message) }
    finally { setBusy(false); setMediaRevision(value => value + 1) }
  }

  return <><OwnerContentEditor mediaRevision={mediaRevision} /><section style={{ maxWidth: 920, margin: '16px auto', padding: 20, border: '1px solid #99688f', borderRadius: 16, background: '#22152c' }}>
    <h2>Private media vault</h2>
    <p>Upload multiple private photos and videos directly from your phone or computer. Choose the area and collection once. Existing files are skipped; failed files remain selected for retry.</p>
    <form onSubmit={upload} style={{ display: 'grid', gap: 12 }}>
      <label>Area{' '}
        <select aria-label="Private media area" value={area} disabled={busy} onChange={e => setArea(e.target.value)}>
          {AREAS.map(name => <option key={name} value={name}>{name}</option>)}
        </select>
      </label>
      <label>Files (select multiple){' '}
        <input aria-label="Choose private media" type="file" accept=".jpg,.jpeg,.png,.webp,.gif,.mp4,.webm" multiple disabled={busy}
          onChange={e => { const selected = Array.from(e.target.files || []); setFiles(selected); setFileNames(selected.map(file => file.name)); setResults([]); setMessage('') }} />
      </label>
      <p role="status">{files.length} file(s) ready{busy ? ' — uploading...' : ''}</p>
      {files.length > 0 && <div style={{ display: 'grid', gap: 8 }}>
        <p>Stored filenames (editable). Android may supply a numeric filename. Enter the intended name, including its extension, before uploading.</p>
        {files.map((file, i) => <label key={i} style={{ display: 'grid', gap: 4 }}>
          <span>File {i + 1}: {file.name}</span>
          <input type="text" aria-label={'Stored filename ' + (i + 1)} value={fileNames[i] ?? ''} maxLength={180} disabled={busy} required
            style={{ width: '100%', boxSizing: 'border-box' }} onChange={e => setFileNames(previous => previous.map((name, index) => index === i ? e.target.value : name))} />
          <small>Will be stored as: {createCollectionName(fileNames[i] || '', collection) || 'Enter a filename'}</small>
        </label>)}
      </div>}
      <label>Collection (optional){' '}
        <input aria-label="Private media collection" type="text" value={collection} maxLength={48} disabled={busy}
          placeholder="e.g. Velvet After Dark" onChange={e => setCollection(e.target.value)} />
      </label>
      <button disabled={busy || !files.length} type="submit">{busy ? 'Uploading batch...' : results.some(item => item.status.startsWith('Failed')) ? 'Retry failed files' : 'Upload selected files'}</button>
    </form>
    {progress && <p role="status" aria-live="polite">{progress}</p>}
    {message && <p role="status">{message}</p>}
    {results.length > 0 && <details open><summary>Upload results ({results.length})</summary>
      <ul>{results.map((item, i) => <li key={i}>{item.name}: {item.status}</li>)}</ul>
    </details>}
    <p style={{ marginTop: 20 }}>Member view: <a href={'/afterhours-members.html?area=' + area} target="_blank" rel="noopener noreferrer" style={{ color: '#ffb8e4' }}>Open {area}'s private galleries and reels</a></p>
    <details style={{ marginTop: 20 }}>
      <summary>Advanced: optional workstation pairing</summary>
      <p>Only needed for automated laptop uploads. Browser uploads above require no pairing key.</p>
      <button type="button" disabled={pairingBusy} onClick={pairWorkstation}>Create workstation pairing key</button>{' '}
      <button type="button" disabled={pairingBusy} onClick={revokePairings}>Revoke workstation keys</button>
      {pairingToken && <div><input type="text" readOnly aria-label="Workstation pairing key" value={pairingToken} onFocus={e => e.target.select()} />
        <button type="button" onClick={() => navigator.clipboard.writeText(pairingToken).then(() => setPairingStatus('Copied.')).catch(() => setPairingStatus('Select and copy the key manually.'))}>Copy key</button></div>}
      <p>Never share workstation keys in chat or logs. Pair locally using scripts/afterhours-upload.ps1 -Pair.</p>
      {pairingStatus && <p role="status">{pairingStatus}</p>}
    </details>
    <details style={{ marginTop: 20 }}>
      <summary>Advanced: import 39 existing Penny media files</summary>
      <p>Owner only. Verifies the private bucket, then imports missing approved media. Existing public URLs are unchanged.</p>
      <button type="button" disabled={busy} onClick={importExistingPennyMedia}>Verify bucket and import 39 Penny files</button>
    </details>
  </section></>
}
