import { databaseSql, partyDatabaseUrl } from './database-sql.js'
import { emptyContent } from '../src/afterhours/contentModel.js'
import { emptyStripagram } from '../src/afterhours/stripagramModel.js'
let schema
function sqlClient() {
  if (!partyDatabaseUrl()) throw new Error('Database unavailable')
  return databaseSql(partyDatabaseUrl())
}
async function ready() {
  const sql=sqlClient()
  if (!schema) schema=sql`CREATE TABLE IF NOT EXISTS wildcard_creator_content (
    area varchar(16) PRIMARY KEY CHECK (area IN ('penny','kandy','ashley')),
    revision integer NOT NULL DEFAULT 0, content jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
  )`.catch(e=>{schema=null;throw e})
  await schema
  return sql
}
export async function readContent(area) {
  const sql=await ready()
  const [row]=await sql`SELECT revision, content FROM wildcard_creator_content WHERE area=${area}`
  return row || {revision:0,content:emptyContent()}
}
export async function saveContent(area, revision, content) {
  const sql=await ready()
  await sql`INSERT INTO wildcard_creator_content (area,content) VALUES (${area},${JSON.stringify(emptyContent())}::jsonb) ON CONFLICT (area) DO NOTHING`
  const [row]=await sql`UPDATE wildcard_creator_content SET revision=revision+1,content=${JSON.stringify(content)}::jsonb,updated_at=now()
    WHERE area=${area} AND revision=${revision} RETURNING revision,content`
  return row || null
}

let stripagramSchema
async function stripagramReady(){
 const sql=sqlClient()
 if(!stripagramSchema)stripagramSchema=sql`CREATE TABLE IF NOT EXISTS wildcard_stripagram_content (
   area varchar(16) PRIMARY KEY CHECK (area IN ('penny','kandy','ashley')),
   revision integer NOT NULL DEFAULT 0, content jsonb NOT NULL,
   updated_at timestamptz NOT NULL DEFAULT now()
 )`.catch(e=>{stripagramSchema=null;throw e})
 await stripagramSchema
 return sql
}
export async function readStripagram(area){
 const sql=await stripagramReady()
 const [row]=await sql`SELECT revision,content FROM wildcard_stripagram_content WHERE area=${area}`
 return row||{revision:0,content:emptyStripagram(area)}
}
export async function saveStripagram(area,revision,content){
 const sql=await stripagramReady()
 await sql`INSERT INTO wildcard_stripagram_content(area,content) VALUES (${area},${JSON.stringify(emptyStripagram(area))}::jsonb) ON CONFLICT(area) DO NOTHING`
 const [row]=await sql`UPDATE wildcard_stripagram_content SET revision=revision+1,content=${JSON.stringify(content)}::jsonb,updated_at=now() WHERE area=${area} AND revision=${revision} RETURNING revision,content`
 return row||null
}
