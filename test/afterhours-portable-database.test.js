import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync,readdirSync} from 'node:fs'
import {databaseTransport,postgresTag,postgresPoolOptions} from '../lib/database-sql.js'
test('existing Neon URLs use the current HTTP driver; other PostgreSQL hosts use standard wire protocol',()=>{
 assert.equal(databaseTransport('postgresql://u:p@ep-test.us-east-1.aws.neon.tech/db'),'neon-http')
 assert.equal(databaseTransport('postgresql://u:p@pooler.supabase.com:6543/postgres'),'postgres')
 assert.equal(databaseTransport('postgresql://u:p@127.0.0.1:5432/party'),'postgres')
 assert.equal(databaseTransport('postgresql://u:p@neon.tech.example.com/db'),'postgres')
 assert.throws(()=>databaseTransport('https://example.com'))
})
test('SQL templates retain placeholders, typed values and row return shape',async()=>{
 let actual
 const sql=postgresTag(async(text,values)=>{actual={text,values};return {rows:[{ok:1}]}})
 const input="'; DROP TABLE x; --"
 const rows=await sql`SELECT ${input}::text, ${7}::integer, ${null}::text`
 assert.deepEqual(actual,{text:'SELECT $1::text, $2::integer, $3::text',values:[input,7,null]})
 assert.deepEqual(rows,[{ok:1}])
 await assert.rejects(()=>sql('SELECT 1'),/tagged template/)
})
test('remote PostgreSQL cannot silently disable certificate checks; local development can use explicit non-TLS',()=>{
 const remote=postgresPoolOptions('postgresql://u:p@db.example.com/db?sslmode=disable')
 assert.equal(new URL(remote.connectionString).searchParams.get('sslmode'),'verify-full')
 const local=postgresPoolOptions('postgresql://u:p@localhost/db?sslmode=disable')
 assert.equal(new URL(local.connectionString).searchParams.get('sslmode'),'disable')
 assert.equal(remote.max,2)
})
test('production database modules route through shared adapter',()=>{
 const dir=new URL('../lib/',import.meta.url)
 for(const file of readdirSync(dir).filter(x=>x.endsWith('.js')&&x!=='database-sql.js')){
  const s=readFileSync(new URL(file,dir),'utf8')
  assert.doesNotMatch(s,/from ['"]@neondatabase\/serverless['"]/,file)
 }
})
