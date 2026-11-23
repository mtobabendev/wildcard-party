import { randomUUID } from 'node:crypto'
import { neon } from '@neondatabase/serverless'
import { ensureIdentitySchema } from './auth-db.js'

export const AFTER_HOURS_AREAS = Object.freeze(['penny', 'kandy', 'ashley'])
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
let schemaPromise

function database() {
  if (!process.env.DATABASE_URL) {
    const error = new Error('Database is not configured.')
    error.code = 'DATABASE_NOT_CONFIGURED'
    throw error
  }
  return neon(process.env.DATABASE_URL)
}

export function validArea(value) {
  return typeof value === 'string' && AFTER_HOURS_AREAS.includes(value) ? value : ''
}

export function validAccountId(value) {
  return typeof value === 'string' && UUID.test(value) ? value.toLowerCase() : ''
}

export async function ensureAfterHoursSchema() {
  await ensureIdentitySchema()
  if (!schemaPromise) {
    schemaPromise = (async () => {
      const sql = database()
      await sql`
        CREATE TABLE IF NOT EXISTS wildcard_afterhours_grants (
          account_id uuid NOT NULL REFERENCES wildcard_accounts(id) ON DELETE CASCADE,
          area varchar(16) NOT NULL CHECK (area IN ('penny', 'kandy', 'ashley')),
          granted_by uuid NOT NULL REFERENCES wildcard_accounts(id),
          granted_at timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY (account_id, area)
        )
      `
      await sql`
        CREATE TABLE IF NOT EXISTS wildcard_afterhours_audit (
          id uuid PRIMARY KEY,
          actor_id uuid NOT NULL REFERENCES wildcard_accounts(id),
          target_id uuid REFERENCES wildcard_accounts(id) ON DELETE SET NULL,
          action varchar(32) NOT NULL,
          area varchar(16),
          occurred_at timestamptz NOT NULL DEFAULT now()
        )
      `
    })().catch(error => {
      schemaPromise = null
      throw error
    })
  }
  return schemaPromise
}

export async function hasAreaGrant(accountId, area) {
  const id = validAccountId(accountId)
  const requested = validArea(area)
  if (!id || !requested) return false
  await ensureAfterHoursSchema()
  const sql = database()
  const rows = await sql`
    SELECT 1 FROM wildcard_afterhours_grants
    WHERE account_id = ${id}::uuid AND area = ${requested} LIMIT 1
  `
  return rows.length === 1
}

export async function listMemberAccess(query = '') {
  await ensureAfterHoursSchema()
  const sql = database()
  const search = typeof query === 'string' ? query.trim().slice(0, 60) : ''
  // Literal substring search, not a LIKE pattern: % and _ are ordinary characters.
  const rows = await sql`
    SELECT a.id, a.handle, a.display_name, a.email,
      COALESCE(array_agg(g.area ORDER BY g.area) FILTER (WHERE g.area IS NOT NULL), ARRAY[]::varchar[]) AS areas
    FROM wildcard_accounts a
    LEFT JOIN wildcard_afterhours_grants g ON g.account_id = a.id
    WHERE position(lower(${search}) in lower(a.handle)) > 0
       OR position(lower(${search}) in lower(a.display_name)) > 0
    GROUP BY a.id, a.handle, a.display_name, a.email
    ORDER BY a.handle ASC
    LIMIT 60
  `
  return rows.map(row => ({
    id: row.id,
    handle: row.handle,
    displayName: row.display_name,
    email: row.email || '',
    areas: row.areas || [],
  }))
}

export async function changeAreaGrant({ actorId, accountId, area, grant }) {
  const actor = validAccountId(actorId)
  const target = validAccountId(accountId)
  const requested = validArea(area)
  if (!actor || !target || !requested || typeof grant !== 'boolean') return false
  await ensureAfterHoursSchema()
  const sql = database()
  const exists = await sql`SELECT 1 FROM wildcard_accounts WHERE id = ${target}::uuid LIMIT 1`
  if (!exists.length) return false

  if (grant) {
    await sql`
      INSERT INTO wildcard_afterhours_grants (account_id, area, granted_by)
      VALUES (${target}::uuid, ${requested}, ${actor}::uuid)
      ON CONFLICT (account_id, area)
      DO UPDATE SET granted_by = EXCLUDED.granted_by, granted_at = now()
    `
  } else {
    await sql`DELETE FROM wildcard_afterhours_grants WHERE account_id = ${target}::uuid AND area = ${requested}`
  }
  await recordAccessAudit({ actorId: actor, accountId: target, action: grant ? 'grant' : 'revoke', area: requested })
  return true
}

export async function recordAccessAudit({ actorId, accountId, action, area = null }) {
  const actor = validAccountId(actorId)
  const target = validAccountId(accountId)
  if (!actor || !target || !['create-account', 'reset-password', 'grant', 'revoke'].includes(action)) {
    throw new Error('Invalid access audit.')
  }
  await ensureAfterHoursSchema()
  const sql = database()
  await sql`
    INSERT INTO wildcard_afterhours_audit (id, actor_id, target_id, action, area)
    VALUES (${randomUUID()}::uuid, ${actor}::uuid, ${target}::uuid, ${action}, ${validArea(area) || null})
  `
}
