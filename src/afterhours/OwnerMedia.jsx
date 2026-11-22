import { useState } from 'react'

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

export default function OwnerMedia() {
  const [area, setArea] = useState('penny')
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  async function upload(event) {
    event.preventDefault()
    if (!file || busy) return
    setMessage('')
    setBusy(true)
    try {
      const { upload: ticket } = await api({
        action: 'start', area, name: file.name,
        contentType: file.type, byteSize: file.size,
      })
      const sent = await fetch(ticket.uploadUrl, {
        method: 'PUT', headers: { 'Content-Type': ticket.contentType }, body: file,
      })
      if (!sent.ok) throw new Error('Storage rejected the upload (' + sent.status + ').')
      await api({ action: 'finish', id: ticket.id })
      setMessage('Secure upload verified. ' + file.name + ' is now available only to approved ' + area + ' members.')
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
    <p>Upload new private images or videos to the existing private storage. Public /static/ files do not become private until their public copies are removed and references are migrated.</p>
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
      <button disabled={busy || !file} type="submit">{busy ? 'Uploading…' : 'Upload to private vault'}</button>
    </form>
    {message && <p role="status">{message}</p>}
  </section>
}
