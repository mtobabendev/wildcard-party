import { neon } from '@neondatabase/serverless'
// Dedicated synthetic authorization DB. Never use the private journal or Party DB URL.
export function demoOAuthStore(env){
 const sql=()=>neon(env.PENNYCORE_MCP_DEMO_DB_URL)
 return {
  async begin(p){const q=sql();await q`INSERT INTO demo_oauth_grants(nonce_hash,account_id,client_id,redirect_uri,oauth_state,challenge,resource,scope) VALUES(${p.nonceHash},${p.account}::uuid,${p.client},${p.redirect},${p.state},${p.challenge},${p.resource},${p.scope})`},
  async decide(p){const q=sql();const rows=await q`UPDATE demo_oauth_grants SET consent_used=true,code_hash=${p.codeHash},code_expires=now()+interval '2 minutes' WHERE nonce_hash=${p.nonceHash} AND account_id=${p.account}::uuid AND NOT consent_used AND NOT revoked AND consent_expires>now() RETURNING redirect_uri,oauth_state`;return rows[0]||null},
  async exchange(p){const q=sql();const rows=await q`UPDATE demo_oauth_grants SET token_hash=${p.tokenHash},token_expires=now()+interval '15 minutes' WHERE code_hash=${p.codeHash} AND account_id=${p.account}::uuid AND client_id=${p.client} AND redirect_uri=${p.redirect} AND challenge=${p.challenge} AND resource=${p.resource} AND scope=${p.scope} AND consent_used AND token_hash IS NULL AND NOT revoked AND code_expires>now() RETURNING 1 AS ok`;return rows.length===1},
  async verify(p){const q=sql();const rows=await q`SELECT 1 AS ok FROM demo_oauth_grants WHERE token_hash=${p.tokenHash} AND account_id=${p.account}::uuid AND client_id=${p.client} AND resource=${p.resource} AND scope=${p.scope} AND NOT revoked AND token_expires>now()`;return rows.length===1},
  async revoke(p){const q=sql();await q`UPDATE demo_oauth_grants SET revoked=true WHERE token_hash=${p.tokenHash} AND account_id=${p.account}::uuid AND client_id=${p.client}`},
  async revokeAll(account){const q=sql();await q`UPDATE demo_oauth_grants SET revoked=true WHERE account_id=${account}::uuid AND NOT revoked`}
 }
}
