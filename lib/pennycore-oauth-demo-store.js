import { neon } from '@neondatabase/serverless'
// Dedicated synthetic authorization DB. Never use the private journal or Party DB URL.
export function demoOAuthStore(env){
 const sql=()=>neon(env.PENNYCORE_MCP_DEMO_DB_URL)
 return {
  async register(p){
   const q=sql()
   // Bound public registration. No secret value is stored. Expired slots can be reused.
   for(let attempt=0;attempt<3;attempt++){
    const rows=await q`INSERT INTO demo_oauth_clients(slot,client_id,account_id,redirect_uris,auth_method,secret_hash)
     SELECT s,${p.id},${p.account}::uuid,${JSON.stringify(p.redirects)}::jsonb,${p.method},${p.secretHash}
     FROM generate_series(1,64) s
     WHERE NOT EXISTS(SELECT 1 FROM demo_oauth_clients c WHERE c.slot=s AND c.expires_at>now())
     ORDER BY s LIMIT 1
     ON CONFLICT(slot) DO UPDATE SET client_id=excluded.client_id,account_id=excluded.account_id,redirect_uris=excluded.redirect_uris,auth_method=excluded.auth_method,secret_hash=excluded.secret_hash,created_at=now(),expires_at=now()+interval '30 days'
     WHERE demo_oauth_clients.expires_at<=now()
     RETURNING floor(extract(epoch from created_at))::integer AS issued,floor(extract(epoch from expires_at))::integer AS expires`
    if(rows.length)return rows[0]
   }
   return null
  },
  async client(p){const q=sql();const rows=await q`SELECT client_id,redirect_uris,auth_method,secret_hash FROM demo_oauth_clients WHERE client_id=${p.id} AND account_id=${p.account}::uuid AND expires_at>now()`;return rows[0]||null},
  async begin(p){const q=sql();await q`INSERT INTO demo_oauth_grants(nonce_hash,account_id,client_id,redirect_uri,oauth_state,challenge,resource,scope) VALUES(${p.nonceHash},${p.account}::uuid,${p.client},${p.redirect},${p.state},${p.challenge},${p.resource},${p.scope})`},
  async decide(p){const q=sql();const rows=await q`UPDATE demo_oauth_grants g SET consent_used=true,code_hash=${p.codeHash},code_expires=now()+interval '2 minutes' WHERE nonce_hash=${p.nonceHash} AND g.account_id=${p.account}::uuid AND NOT consent_used AND NOT revoked AND consent_expires>now() AND EXISTS(SELECT 1 FROM demo_oauth_clients c WHERE c.client_id=g.client_id AND c.account_id=g.account_id AND c.expires_at>now() AND c.redirect_uris ? g.redirect_uri) RETURNING redirect_uri,oauth_state`;return rows[0]||null},
  async exchange(p){const q=sql();const rows=await q`UPDATE demo_oauth_grants g SET token_hash=${p.tokenHash},token_expires=now()+interval '15 minutes' WHERE code_hash=${p.codeHash} AND g.account_id=${p.account}::uuid AND g.client_id=${p.client} AND redirect_uri=${p.redirect} AND challenge=${p.challenge} AND resource=${p.resource} AND scope=${p.scope} AND consent_used AND token_hash IS NULL AND NOT revoked AND code_expires>now() AND EXISTS(SELECT 1 FROM demo_oauth_clients c WHERE c.client_id=g.client_id AND c.account_id=g.account_id AND c.expires_at>now() AND c.redirect_uris ? g.redirect_uri) RETURNING 1 AS ok`;return rows.length===1},
  async verify(p){const q=sql();const rows=await q`SELECT 1 AS ok FROM demo_oauth_grants g JOIN demo_oauth_clients c ON c.client_id=g.client_id AND c.account_id=g.account_id WHERE g.token_hash=${p.tokenHash} AND g.account_id=${p.account}::uuid AND g.resource=${p.resource} AND g.scope=${p.scope} AND NOT g.revoked AND g.token_expires>now() AND c.expires_at>now() AND c.redirect_uris ? g.redirect_uri AND ${JSON.stringify(p.redirects)}::jsonb ? g.redirect_uri`;return rows.length===1},
  async revoke(p){const q=sql();await q`UPDATE demo_oauth_grants SET revoked=true WHERE token_hash=${p.tokenHash} AND account_id=${p.account}::uuid AND client_id=${p.client}`},
  async revokeAll(account){const q=sql();await q`UPDATE demo_oauth_grants SET revoked=true WHERE account_id=${account}::uuid AND NOT revoked`}
 }
}
