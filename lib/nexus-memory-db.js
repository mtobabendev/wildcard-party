import { neon } from '@neondatabase/serverless'
import { PAGE_SIZE } from './nexus-memory-state.js'

export function memoryStore(env) {
  const sql = () => neon(env.NEXUS_MEMORY_DATABASE_URL)
  return {
    async list(account, before) {
      const q=sql()
      return before ? q`SELECT id::text AS id, request_id::text AS request_id, envelope, created_at::text AS created_at
        FROM nexus_owner_memory WHERE account_id=${account}::uuid AND id < ${before}::bigint ORDER BY id DESC LIMIT ${PAGE_SIZE+1}` :
        q`SELECT id::text AS id, request_id::text AS request_id, envelope, created_at::text AS created_at
        FROM nexus_owner_memory WHERE account_id=${account}::uuid ORDER BY id DESC LIMIT ${PAGE_SIZE+1}`
    },
    async append(account, requestId, envelope) {
      const q=sql()
      const rows=await q`INSERT INTO nexus_owner_memory(account_id,request_id,envelope)
        VALUES(${account}::uuid,${requestId}::uuid,${envelope})
        ON CONFLICT(account_id,request_id) DO NOTHING
        RETURNING id::text AS id,request_id::text AS request_id,envelope,created_at::text AS created_at`
      if(rows.length) return {row:rows[0],duplicate:false}
      const existing=await q`SELECT id::text AS id,request_id::text AS request_id,envelope,created_at::text AS created_at
        FROM nexus_owner_memory WHERE account_id=${account}::uuid AND request_id=${requestId}::uuid`
      if(existing.length!==1)throw Error('Capture retry unavailable.')
      return {row:existing[0],duplicate:true}
    }
  }
}
