#!/usr/bin/env node
// Owner workstation upload bridge. Uses only Party's existing upload API.
import { basename, isAbsolute } from 'node:path'
import { readFile, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'

const API = 'https://party.wildcarddev.com/api/afterhours/media-admin'
const TYPES = { '.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png',
  '.webp':'image/webp','.gif':'image/gif','.mp4':'video/mp4','.webm':'video/webm','.mp3':'audio/mpeg' }

export function parseArgs(argv) {
  const args = { mode:'check', area:'penny', file:'', name:'', newVersion:false }
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]
    if (flag === '--new-version') { args.newVersion = true; continue }
    if (!['--mode','--area','--file','--name'].includes(flag)) throw new Error('Unknown option.')
    const value = argv[++i]
    if (!value || value.startsWith('--')) throw new Error('Missing option value.')
    args[flag.slice(2)] = value
  }
  if (!['check','upload'].includes(args.mode)) throw new Error('Mode must be check or upload.')
  if (!['penny','kandy','ashley'].includes(args.area)) throw new Error('Invalid area.')
  if (args.file && !isAbsolute(args.file)) throw new Error('File path must be absolute.')
  if (args.mode === 'upload' && !args.file) throw new Error('File required for upload.')
  if (args.newVersion && args.mode !== 'upload') throw new Error('New version requires upload.')
  args.name ||= args.file ? basename(args.file) : ''
  if (args.name && (!/^[^\u0000-\u001f\u007f\\/]{1,180}$/.test(args.name) || args.name.trim() !== args.name)) {
    throw new Error('Invalid filename.')
  }
  return args
}
export function mimeOf(name) {
  return TYPES[name.toLowerCase().match(/\.[a-z0-9]+$/)?.[0]] || ''
}
export function tokenValid(value) {
  return typeof value === 'string' && /^wcu1_[A-Za-z0-9_-]{43}$/.test(value)
}

export async function run(argv, { token = process.env.WCD_UPLOAD_TOKEN,
  fetcher = fetch, output = console.log } = {}) {
  const args = parseArgs(argv)
  if (!tokenValid(token)) throw new Error('Owner workstation is not paired.')

  async function api(body) {
    const res = await fetcher(API, {
      method:'POST', cache:'no-store', redirect:'error',
      headers:{ 'Content-Type':'application/json', 'Authorization':'Bearer ' + token },
      body:JSON.stringify(body), signal:AbortSignal.timeout(20000),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error('Party rejected the upload request (HTTP ' + res.status + ').')
    return data
  }
  const check = () => api({ action:'check', area:args.area, ...(args.name ? { name:args.name } : {}) })
  const current = await check()
  if (args.mode === 'check') {
    output('Party upload connection VERIFIED; area: ' + args.area)
    if (args.name) output(current.exists ? 'Existing ready asset: ' + args.name : 'Not present: ' + args.name)
    if (current.uploadProvider) output('New upload provider: ' + current.uploadProvider)
    if (current.storageProvider) output('Stored object provider: ' + current.storageProvider)
    return { checked:true, exists:current.exists }
  }
  if (current.exists && !args.newVersion) {
    output('SKIPPED: Already uploaded, no duplicate: ' + args.name)
    return { uploaded:false, existing:true }
  }
  const type = mimeOf(args.name)
  if (!type) throw new Error('Unsupported file type.')
  if (type === 'audio/mpeg' && current.uploadProvider !== 'supabase') {
    throw new Error('Owner music uploads require the Supabase storage provider.')
  }
  const info = await stat(args.file)
  if (!info.isFile() || info.size < 1 || info.size > 150 * 1024 * 1024) throw new Error('Invalid file size.')
  const bytes = await readFile(args.file)
  const ticket = (await api({ action:'start', area:args.area, name:args.name,
    contentType:type, byteSize:bytes.length })).upload
  if (!ticket?.uploadUrl || !ticket?.id || !ticket?.contentType ||
      new URL(ticket.uploadUrl).protocol !== 'https:') throw new Error('Private upload ticket invalid.')
  const response = await fetcher(ticket.uploadUrl, { method:'PUT', redirect:'error',
    headers:{ 'Content-Type':ticket.contentType }, body:bytes,
    signal:AbortSignal.timeout(600000) })
  if (!response.ok) throw new Error('Private storage transfer failed (HTTP ' + response.status + ').')
  await api({ action:'finish', id:ticket.id })
  const verified = await check()
  if (!verified.exists || verified.type !== type) throw new Error('Private upload did not verify.')
  output('VERIFIED upload: ' + args.area + '/' + args.name + ' (' + bytes.length +
    ' bytes; SHA256 ' + createHash('sha256').update(bytes).digest('hex') + ')')
  return { uploaded:true, verified:true }
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('/afterhours-upload.mjs')) {
  try { await run(process.argv.slice(2)) }
  catch (e) {
    const safe = /^(Owner|Party rejected|Private|Unsupported|Invalid|Unknown|Missing|Mode|File|New version)/.test(e?.message || '')
      ? e.message : 'Local file or network unavailable.'
    console.error('Upload stopped: ' + safe)
    process.exitCode = 1
  }
}
