import { randomUUID } from 'node:crypto'
import { databaseSql, partyDatabaseUrl } from './database-sql.js'

export const CONTINUITY_HOURS = 24
export const MAX_EXCHANGES = 4
const SNOWFLAKE = /^\d{17,20}$/
let schemaPromise

export function conversationSubject(guild, channel, user) {
  if (![guild,channel,user].every(x => typeof x === 'string' && SNOWFLAKE.test(x))) return ''
  return 'discord:' + guild + ':' + channel + ':' + user
}
export function validateExchange(value) {
  return !!(value && typeof value.interactionId === 'string' && SNOWFLAKE.test(value.interactionId)
    && typeof value.question === 'string' && value.question.trim().length >= 1 && value.question.length <= 1800
    && typeof value.answer === 'string' && value.answer.trim().length >= 1 && value.answer.length <= 1900)
}
async function ensureSchema(sql) {
  if(!schemaPromise){
    schemaPromise=(async()=>{
      await sql`CREATE TABLE IF NOT EXISTS penny_conversation_optins (
        subject varchar(110) PRIMARY KEY,
        enabled_at timestamptz NOT NULL DEFAULT now()
      )`
      await sql`CREATE TABLE IF NOT EXISTS penny_conversation_exchanges (
        id uuid PRIMARY KEY,
        subject varchar(110) NOT NULL,
        interaction_id varchar(20) NOT NULL,
        question varchar(1800) NOT NULL,
        answer varchar(1900) NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE(subject,interaction_id)
      )`
      await sql`CREATE INDEX IF NOT EXISTS penny_conversation_recent_idx
        ON penny_conversation_exchanges(subject,created_at DESC)`
    })().catch(err=>{schemaPromise=null;throw err})
  }
  return schemaPromise
}
export async function conversationAction(action, subject, exchange) {
  const url=partyDatabaseUrl()
  if(!url) throw new Error('Party database unavailable')
  const sql=databaseSql(url)
  await ensureSchema(sql)
  // Expired text is purged on access; it is never read after 24 hours.
  await sql`DELETE FROM penny_conversation_exchanges
    WHERE created_at < now() - interval '24 hours'`
  if(action==='enable'){
    await sql`INSERT INTO penny_conversation_optins(subject)
      VALUES(${subject}) ON CONFLICT(subject) DO NOTHING`
    return {enabled:true}
  }
  if(action==='disable'){
    await sql`DELETE FROM penny_conversation_exchanges WHERE subject=${subject}`
    await sql`DELETE FROM penny_conversation_optins WHERE subject=${subject}`
    return {enabled:false,cleared:true}
  }
  if(action==='clear'){
    await sql`DELETE FROM penny_conversation_exchanges WHERE subject=${subject}`
    return {cleared:true}
  }
  if(action==='read'){
    const active=await sql`SELECT 1 FROM penny_conversation_optins WHERE subject=${subject} LIMIT 1`
    if(!active.length)return {enabled:false,exchanges:[]}
    const rows=await sql`SELECT question,answer FROM penny_conversation_exchanges
      WHERE subject=${subject} AND created_at >= now() - interval '24 hours'
      ORDER BY created_at DESC,id DESC LIMIT ${MAX_EXCHANGES}`
    return {enabled:true,exchanges:rows.reverse()}
  }
  if(action==='append'){
    if(!validateExchange(exchange))return {error:'Invalid exchange'}
    const active=await sql`SELECT 1 FROM penny_conversation_optins WHERE subject=${subject} LIMIT 1`
    if(!active.length)return {enabled:false,stored:false}
    await sql`INSERT INTO penny_conversation_exchanges(id,subject,interaction_id,question,answer)
      VALUES(${randomUUID()}::uuid,${subject},${exchange.interactionId},
        ${exchange.question.trim()},${exchange.answer.trim()})
      ON CONFLICT(subject,interaction_id) DO NOTHING`
    await sql`DELETE FROM penny_conversation_exchanges
      WHERE subject=${subject} AND id NOT IN (
        SELECT id FROM penny_conversation_exchanges WHERE subject=${subject}
        ORDER BY created_at DESC,id DESC LIMIT ${MAX_EXCHANGES}
      )`
    return {enabled:true,stored:true}
  }
  return {error:'Unsupported operation'}
}
