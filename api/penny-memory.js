import { timingSafeEqual, randomUUID } from 'node:crypto'
import { databaseSql, partyDatabaseUrl } from '../lib/database-sql.js'

let schemaPromise
export function authorized(header, secret) {
  if (typeof secret !== 'string' || secret.length < 40 || typeof header !== 'string' || !header.startsWith('Bearer ')) return false
  const actual=Buffer.from(header.slice(7))
  const expected=Buffer.from(secret)
  return actual.length === expected.length && timingSafeEqual(actual,expected)
}
export function subjectId(guild,user) {
  return /^\\d{17,20}$/.test(guild||'') && /^\\d{17,20}$/.test(user||'') ? 'discord:'+guild+':'+user : ''
}
export function normalizeNote(value) {
  if(typeof value!=='string') return ''
  const note=value.trim().replace(/\\s+/g,' ')
  return note.length>=2 && note.length<=500 ? note : ''
}
async function store() {
  const url=partyDatabaseUrl()
  if(!url) throw new Error('Memory database not configured')
  const sql=databaseSql(url)
  if(!schemaPromise) {
    schemaPromise=(async()=>{
      await sql\`CREATE TABLE IF NOT EXISTS penny_public_notes (
        id uuid PRIMARY KEY, subject varchar(100) NOT NULL, note varchar(500) NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(subject,note)
      )\`
      await sql\`CREATE INDEX IF NOT EXISTS penny_public_notes_subject_idx
        ON penny_public_notes(subject,created_at)\`
    })().catch(err=>{schemaPromise=undefined;throw err})
  }
  await schemaPromise
  return sql
}
export async function act(action,subject,note,id) {
  const sql=await store()
  if(action==='list'){
    return {items:await sql\`SELECT id::text AS id,note FROM penny_public_notes
      WHERE subject=\${subject} ORDER BY created_at,id LIMIT 20\`}
  }
  if(action==='add'){
    const clean=normalizeNote(note)
    if(!clean) return {error:'Invalid memory'}
    const rows=await sql\`INSERT INTO penny_public_notes(id,subject,note)
      SELECT \${randomUUID()}::uuid,\${subject},\${clean}
      WHERE (SELECT count(*) FROM penny_public_notes WHERE subject=\${subject}) < 20
      ON CONFLICT(subject,note) DO NOTHING RETURNING id\`
    if(!rows.length){
      const current=await act('list',subject)
      if(!current.items.some(x=>x.note===clean))return {error:'Memory is full (20 notes). Forget one first.'}
    }
    return {saved:true}
  }
  if(action==='clear'){
    await sql\`DELETE FROM penny_public_notes WHERE subject=\${subject}\`
    return {cleared:true}
  }
  if(action==='forget'){
    if(!/^[0-9a-f-]{36}$/i.test(id||''))return {error:'Invalid note ID'}
    const rows=await sql\`DELETE FROM penny_public_notes
      WHERE subject=\${subject} AND id=\${id}::uuid RETURNING id\`
    return {deleted:rows.length}
  }
  return {error:'Invalid action'}
}
export default async function handler(req,res) {
  res.setHeader('Cache-Control','no-store')
  res.setHeader('X-Content-Type-Options','nosniff')
  if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({error:'POST only'})}
  if(!authorized(req.headers.authorization,process.env.PENNY_MEMORY_BRIDGE_SECRET))
    return res.status(401).json({error:'Unauthorized'})
  try{
    const b=typeof req.body==='string'?JSON.parse(req.body):req.body
    if(!b || Buffer.byteLength(JSON.stringify(b))>2048)return res.status(400).json({error:'Invalid request'})
    const subject=subjectId(b.guildId,b.userId)
    if(!subject||!['add','list','forget','clear'].includes(b.action))
      return res.status(400).json({error:'Invalid identity or action'})
    if(b.action==='add'&&!normalizeNote(b.note))return res.status(400).json({error:'Invalid memory note'})
    const result=await act(b.action,subject,b.note,b.id)
    return res.status(result.error?409:200).json(result)
  }catch{
    // Never log personal notes, bearer values, or database exceptions.
    return res.status(503).json({error:'Memory temporarily unavailable'})
  }
}
