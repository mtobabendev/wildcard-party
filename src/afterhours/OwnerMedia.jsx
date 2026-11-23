import { useState } from 'react'
import { createCollectionName } from './mediaCollections.js'

const AREAS = ['penny', 'kandy', 'ashley']
async function api(body) {
  const res = await fetch('/api/afterhours/media-admin', {
    method: 'POST', credentials: 'same-origin', cache: 'no-store',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  const payload = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(payload.error || 'Media service unavailable.')
  return payload
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
  const [file, setFile] = useState(null)
  const [collection, setCollection] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [pairingToken, setPairingToken] = useState('')
  const [pairingBusy, setPairingBusy] = useState(false)
  const [pairingStatus, setPairingStatus] = useState('')

  async function pairWorkstation() {
    if (pairingBusy) return
    setPairingBusy(true)
    setPairingStatus('')
    try {
      const { pairing } = await api({ action: 'pair' })
      if (!pairing?.token) throw new Error('Pairing token was not returned.')
      setPairingToken(pairing.token)
      setPairingStatus('Pairing key created for the existing private uploader. Copy once, then paste into the local pairing command.')
    } catch (error) { setPairingStatus('Pairing failed: ' + error.message) }
    finally { setPairingBusy(false) }
  }

  async function copyPairingToken() {
    try {
      if (!pairingToken) return
      await navigator.clipboard.writeText(pairingToken)
      setPairingStatus('Pairing key copied. Paste it into your laptop terminal, not into chat.')
    } catch { setPairingStatus('Clipboard unavailable. Select and copy the key in the field.') }
  }

  async function revokePairings() {
    if (pairingBusy || !window.confirm('Revoke all paired workstation upload keys? Existing browser sessions are unaffected.')) return
    setPairingBusy(true)
    try {
      const result = await api({ action: 'revoke-pairings' })
      setPairingToken('')
      setPairingStatus((result.revoked || 0) + ' workstation upload key(s) revoked.')
    } catch (error) { setPairingStatus('Revocation failed: ' + error.message) }
    finally { setPairingBusy(false) }
  }

  async function importExistingPennyMedia() {
    if (busy) return
    setBusy(true)
    setMessage('Checking private bucket permissions…')
    try {
      const privacy = await importApi({ action: 'probe' })
      if (privacy.privateBucket !== true) throw new Error('Destination bucket is not verified private.')
      const initial = await importApi({ action: 'status' })
      if (initial.total !== 39 || !Array.isArray(initial.missing)) {
        throw new Error('Expected media inventory was not available.')
      }
      let completed = initial.ready
      for (const name of initial.missing) {
        setMessage('Copying and verifying ' + name + ' (' + completed + '/39)…')
        await importApi({ action: 'import', name })
        completed++
      }
      const final = await importApi({ action: 'status' })
      if (final.ready !== 39 || final.missing.length) {
        throw new Error('Vault import incomplete. You can resume without duplicating ready files.')
      }
      setMessage('All 39 Penny media items are in the private vault. Existing public URLs remain live until the website gate is separately published.')
    } catch (error) {
      setMessage('Import stopped: ' + error.message + ' You can retry to resume missing files.')
    } finally {
      setBusy(false)
    }
  }

  async function upload(event) {
    event.preventDefault()
    if (!file || busy) return
    setMessage('')
    setBusy(true)
    try {
      const { upload: ticket } = await api({
        action: 'start', area, name: createCollectionName(file.name, collection),
        contentType: file.type, byteSize: file.size,
      })
      const sent = await fetch(ticket.uploadUrl, {
        method: 'PUT', headers: { 'Content-Type': ticket.contentType }, body: file,
      })
      if (!sent.ok) throw new Error('Storage rejected the upload (' + sent.status + ').')
      await api({ action: 'finish', id: ticket.id })
      setMessage('Secure upload verified. ' + file.name + ' is now available in the ' + (collection.trim() || 'Private Archive') + ' collection for approved ' + area + ' members.')
      setFile(null)
      event.currentTarget?.reset?.()
    } catch (error) {
      setMessage('Upload failed: ' + error.message)
    } finally {
      setBusy(false)
    }
  }

  return <section style={{ maxWidth: 920, margin: '16px auto', padding: 20, border: '1px solid #99688f', borderRadius: 16, background: '#22152c' }}>
    <h2>Private media vault</h2>
    <p>Upload private images and videos. Use the optional collection name to create a gallery or reel series automatically. Leave it blank for the existing Private Archive. Public /static/ copies remain public until removed.</p>
    <div style={{ margin: '18px 0', padding: 16, border: '1px solid #9a6795', borderRadius: 12 }}>
      <h3>Connect Penny's workstation — one time</h3>
      <p>Authorize the existing Owner laptop to upload future approved photos and videos directly. No new database, manual browser upload, or production secrets copied to the laptop. Pairing expires after 90 days and only authorizes private-media uploads.</p>
      <button type="button" disabled={pairingBusy} onClick={pairWorkstation}>Create workstation pairing key</button>{' '}
      <button type="button" disabled={pairingBusy} onClick={revokePairings}>Revoke workstation keys</button>
      {pairingToken && <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <input type="text" readOnly aria-label="Workstation pairing key" value={pairingToken} onFocus={event => event.target.select()}
          spellCheck={false} autoComplete="off" style={{ flex: '1 1 290px', minWidth: 180 }} />
        <button type="button" onClick={copyPairingToken}>Copy key</button>
      </div>}
      <p style={{ fontSize: 13 }}>Copy the key once, then ask Penny to pair the connected laptop from its clipboard. Manual fallback: run <code>scripts/afterhours-upload.ps1 -Pair</code> and paste at the hidden prompt. Do not send the key through chat. Later uploads run directly through the connected workstation.</p>
      {pairingStatus && <p role="status">{pairingStatus}</p>}
    </div>
    <form onSubmit={upload} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
      <label>Area{' '}
        <select aria-label="Private media area" value={area} onChange={e => setArea(e.target.value)}>
          {AREAS.map(name => <option key={name} value={name}>{name}</option>)}
        </select>
      </label>
      <label>File{' '}
        <input aria-label="Choose private media" type="file" accept=".jpg,.jpeg,.png,.webp,.gif,.mp4,.webm" required
          onChange={e => setFile(e.target.files?.[0] || null)} />
      </label>
      <label>Collection (optional){' '}
        <input aria-label="Private media collection" type="text" value={collection} maxLength={48}
          placeholder="e.g. Velvet After Dark" onChange={e => setCollection(e.target.value)} />
      </label>
      <button disabled={busy || !file} type="submit">{busy ? 'Uploading…' : 'Upload to private vault'}</button>
    </form>
    <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid #6a4d72' }}>
      <p>Member view: <a href={'/afterhours-members.html?area=' + area} target="_blank" rel="noopener noreferrer" style={{ color: '#ffb8e4' }}>Open {area}'s private galleries and reels</a></p>
      <h3>Copy existing Penny media into the private vault</h3>
      <p>Owner only. Verify the production bucket is private, then transfer and verify 39 approved filenames directly from the existing public website. If interrupted, press again to resume. Public links are unchanged until the website gate deploys.</p>
      <button type="button" disabled={busy} onClick={importExistingPennyMedia}>
        {busy ? 'Private media migration running…' : 'Verify bucket and import 39 Penny files'}
      </button>
    </div>
    {message && <p role="status">{message}</p>}
  </section>
}
