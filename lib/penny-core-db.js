import { neon } from '@neondatabase/serverless'
import { emptyState } from './penny-core-state.js'

let schemaPromise

function database() {
  if (!process.env.DATABASE_URL) throw new Error('Penny Core database is not configured.')
  return neon(process.env.DATABASE_URL)
}

async function schema() {
  if (!schemaPromise) {
    schemaPromise = database()`
      CREATE TABLE IF NOT EXISTS wildcard_penny_core_state (
        account_id uuid PRIMARY KEY REFERENCES wildcard_accounts(id) ON DELETE CASCADE,
        revision integer NOT NULL CHECK (revision > 0),
        notes text NOT NULL DEFAULT '' CHECK (char_length(notes) <= 6000),
        history jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(history) = 'array' AND jsonb_array_length(history) <= 40),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `.catch(error => { schemaPromise = null; throw error })
  }
  return schemaPromise
}

function publicState(row) {
  return row ? { revision: row.revision, notes: row.notes, history: row.history } : emptyState()
}

export async function readState(accountId) {
  await schema()
  const sql = database()
  const [row] = await sql`
    SELECT revision, notes, history FROM wildcard_penny_core_state WHERE account_id = ${accountId}::uuid
  `
  return publicState(row)
}

export async function saveState(accountId, expected, next) {
  await schema()
  const sql = database()
  const history = JSON.stringify(next.history)
  const rows = expected === 0 ? await sql`
    INSERT INTO wildcard_penny_core_state (account_id, revision, notes, history)
    VALUES (${accountId}::uuid, 1, ${next.notes}, ${history}::jsonb)
    ON CONFLICT (account_id) DO NOTHING
    RETURNING revision, notes, history
  ` : await sql`
    UPDATE wildcard_penny_core_state
    SET revision = revision + 1, notes = ${next.notes}, history = ${history}::jsonb, updated_at = now()
    WHERE account_id = ${accountId}::uuid AND revision = ${expected}
    RETURNING revision, notes, history
  `
  return rows.length ? publicState(rows[0]) : null
}
