import { randomBytes, scrypt as scryptCallback } from 'node:crypto'
import { promisify } from 'node:util'
import { databaseSql } from './database-sql.js'
import { ensureIdentitySchema, validPassword } from './auth-db.js'
import { validAccountId } from './afterhours-access.js'

const scrypt = promisify(scryptCallback)

export async function resetMemberPassword(accountId, newPassword) {
  const id = validAccountId(accountId)
  if (!id || !validPassword(newPassword)) return false
  await ensureIdentitySchema()
  if (!process.env.DATABASE_URL) return false
  const salt = randomBytes(16)
  const derived = await scrypt(newPassword, salt, 64, {
    N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024,
  })
  // Matches existing Messenger login's scrypt format; plaintext is never stored.
  const hash = ['scrypt', 32768, 8, 1, salt.toString('base64url'), Buffer.from(derived).toString('base64url')].join('$')
  const sql = databaseSql(process.env.DATABASE_URL)

  // A single database statement ensures a password reset never leaves old sessions valid.
  const updated = await sql`
    WITH changed AS (
      UPDATE wildcard_accounts
      SET password_hash = ${hash}, updated_at = now()
      WHERE id = ${id}::uuid
      RETURNING id
    ), invalidated AS (
      DELETE FROM wildcard_sessions
      WHERE account_id IN (SELECT id FROM changed)
      RETURNING id
    )
    SELECT id, (SELECT count(*) FROM invalidated) AS sessions_revoked
    FROM changed
  `
  return updated.length === 1
}
