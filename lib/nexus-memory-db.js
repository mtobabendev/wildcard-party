import { neon } from '@neondatabase/serverless'
import { PAGE_SIZE } from './nexus-memory-state.js'
export function memoryStore(env) {
 const sql=()=>neon(env.NEXUS_MEMORY_DATABASE_URL)
 return {
  async list(account,before){
   const q=sql()
   return before?q`SELECT id::text AS id,request_id::text AS request_id,envelope,created_at::text AS created_at,content_digest,
     ARRAY(SELECT DISTINCT s.source FROM nexus_memory_receipts s WHERE s.account_id=m.account_id AND s.content_digest=m.content_digest ORDER BY s.source) AS sources
     FROM nexus_owner_memory m WHERE account_id=${account}::uuid AND id<${before}::bigint ORDER BY id DESC LIMIT ${PAGE_SIZE+1}`:
    q`SELECT id::text AS id,request_id::text AS request_id,envelope,created_at::text AS created_at,content_digest,
     ARRAY(SELECT DISTINCT s.source FROM nexus_memory_receipts s WHERE s.account_id=m.account_id AND s.content_digest=m.content_digest ORDER BY s.source) AS sources
     FROM nexus_owner_memory m WHERE account_id=${account}::uuid ORDER BY id DESC LIMIT ${PAGE_SIZE+1}`
  },
  async append(account,requestId,envelope,digest,source){
   const q=sql()
   const rows=await q`SELECT * FROM nexus_capture(${account}::uuid,${requestId}::uuid,${envelope},${digest},${source})`
   if(rows.length!==1)throw Error('Capture unavailable.')
   if(rows[0].conflict)return {conflict:true}
   return {row:rows[0],duplicate:rows[0].duplicate}
  }
 }
}
