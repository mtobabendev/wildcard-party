import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync,readdirSync} from 'node:fs'
import {X509Certificate} from 'node:crypto'
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

test('Supabase pooler uses the pinned public CA and verifies the server',()=>{
 const options=postgresPoolOptions('postgresql://u:p@aws-1-us-east-2.pooler.supabase.com:6543/postgres?sslmode=disable')
 assert.equal(options.ssl.rejectUnauthorized,true)
 assert.equal(new URL(options.connectionString).searchParams.has('sslmode'),false)
 const c=new X509Certificate(options.ssl.ca)
 assert.equal(c.ca,true)
 assert.equal(c.fingerprint256,'80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA')
})

test('recovery uses a separate explicit database destination and fails closed on missing recovery owner',async()=>{
 const {partyDatabaseUrl}=await import('../lib/database-sql.js'); const {isOwner}=await import('../lib/penny-owner.js'); const id='11111111-1111-4111-8111-111111111111'; const other='22222222-2222-4222-8222-222222222222';
 assert.equal(partyDatabaseUrl({DATABASE_URL:'old',PARTY_DATABASE_URL:'new'}),'new'); assert.equal(partyDatabaseUrl({DATABASE_URL:'old'}),'old'); assert.equal(isOwner({id},{PARTY_DATABASE_URL:'new',PENNYCORE_OWNER_ACCOUNT_ID:id}),false); assert.equal(isOwner({id},{PARTY_DATABASE_URL:'new',PARTY_RECOVERY_OWNER_ACCOUNT_ID:id,PENNYCORE_OWNER_ACCOUNT_ID:other}),true); assert.equal(isOwner({id:other},{PARTY_DATABASE_URL:'new',PARTY_RECOVERY_OWNER_ACCOUNT_ID:id,PENNYCORE_OWNER_ACCOUNT_ID:other}),false);
})

test('all ordinary database modules use the explicit Party destination',()=>{for(const p of ['auth-db','comms-db','social-db','afterhours-access','afterhours-agent-token','afterhours-legacy-import','afterhours-media','creator-content','penny-core-db','afterhours-password']){const source=readFileSync(new URL('../lib/'+p+'.js',import.meta.url),'utf8');assert.match(source,/partyDatabaseUrl\(\)/,p);assert.doesNotMatch(source,/process\.env\.DATABASE_URL/,p)}})
