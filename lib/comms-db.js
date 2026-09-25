import { randomUUID } from 'node:crypto'
import { neon } from '@neondatabase/serverless'
import { ensureIdentitySchema } from './auth-db.js'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
let schemaPromise

function database() {
  if (!process.env.DATABASE_URL) {
    const error = new Error('DATABASE_URL is not configured.')
    error.code = 'DATABASE_NOT_CONFIGURED'
    throw error
  }
  return neon(process.env.DATABASE_URL)
}

export function normalizeUuid(value) {
  if (typeof value !== 'string') return ''
  const uuid = value.trim().toLowerCase()
  return UUID_PATTERN.test(uuid) ? uuid : ''
}

function normalizePair(first, second) {
  const a = normalizeUuid(first)
  const b = normalizeUuid(second)
  if (!a || !b || a === b) return null
  return a < b ? [a, b] : [b, a]
}

function publicAccount(row, prefix = '') {
  if (!row) return null
  const id = row[`${prefix}id`]
  if (!id) return null
  return {
    id,
    handle: row[`${prefix}handle`],
    displayName: row[`${prefix}display_name`],
  }
}

function publicMessage(row) {
  if (!row?.id) return null
  return {
    id: row.id,
    conversationId: row.conversation_id,
    senderAccountId: row.sender_account_id,
    body: row.body,
    createdAt: row.created_at,
  }
}

function publicReadState(row, prefix = '') {
  if (!row?.[`${prefix}message_id`]) return null
  return {
    messageId: row[`${prefix}message_id`],
    createdAt: row[`${prefix}created_at`],
    readAt: row[`${prefix}read_at`],
  }
}

export async function ensureCommsSchema() {
  await ensureIdentitySchema()

  if (!schemaPromise) {
    schemaPromise = (async () => {
      const sql = database()

      await sql`
        CREATE TABLE IF NOT EXISTS wildcard_conversations (
          id uuid PRIMARY KEY,
          account_a_id uuid NOT NULL
            REFERENCES wildcard_accounts(id) ON DELETE CASCADE,
          account_b_id uuid NOT NULL
            REFERENCES wildcard_accounts(id) ON DELETE CASCADE,
          created_at timestamptz NOT NULL DEFAULT now(),
          CHECK (account_a_id <> account_b_id),
          CHECK (account_a_id < account_b_id),
          UNIQUE (account_a_id, account_b_id)
        )
      `

      await sql`
        CREATE TABLE IF NOT EXISTS wildcard_messages (
          id uuid PRIMARY KEY,
          conversation_id uuid NOT NULL
            REFERENCES wildcard_conversations(id) ON DELETE CASCADE,
          sender_account_id uuid NOT NULL
            REFERENCES wildcard_accounts(id) ON DELETE CASCADE,
          client_message_id uuid NOT NULL,
          body text NOT NULL
            CHECK (char_length(body) BETWEEN 1 AND 4000),
          created_at timestamptz NOT NULL DEFAULT now(),
          UNIQUE (sender_account_id, client_message_id)
        )
      `

      await sql`
        CREATE TABLE IF NOT EXISTS wildcard_conversation_reads (
          conversation_id uuid NOT NULL
            REFERENCES wildcard_conversations(id) ON DELETE CASCADE,
          account_id uuid NOT NULL
            REFERENCES wildcard_accounts(id) ON DELETE CASCADE,
          last_read_message_id uuid NOT NULL
            REFERENCES wildcard_messages(id) ON DELETE CASCADE,
          last_read_created_at timestamptz NOT NULL,
          read_at timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY (conversation_id, account_id)
        )
      `

      await sql`
        CREATE INDEX IF NOT EXISTS wildcard_conversation_reads_account_idx
        ON wildcard_conversation_reads (account_id, conversation_id)
      `

      await sql`
        CREATE INDEX IF NOT EXISTS wildcard_messages_conversation_created_idx
        ON wildcard_messages (conversation_id, created_at, id)
      `

      await sql`
        CREATE INDEX IF NOT EXISTS wildcard_conversations_account_a_idx
        ON wildcard_conversations (account_a_id)
      `

      await sql`
        CREATE INDEX IF NOT EXISTS wildcard_conversations_account_b_idx
        ON wildcard_conversations (account_b_id)
      `
    })().catch((error) => {
      schemaPromise = null
      throw error
    })
  }

  return schemaPromise
}

export async function searchAccounts(accountId, query) {
  await ensureCommsSchema()
  const sql = database()
  const currentId = normalizeUuid(accountId)
  const term = typeof query === 'string' ? query.trim() : ''

  if (!currentId || term.length < 2 || term.length > 60) return []

  const rows = await sql`
    SELECT id, handle, display_name
    FROM wildcard_accounts
    WHERE id <> ${currentId}::uuid
      AND (
        strpos(lower(handle), lower(${term})) > 0
        OR strpos(lower(display_name), lower(${term})) > 0
      )
    ORDER BY
      CASE
        WHEN lower(handle) = lower(${term}) THEN 0
        WHEN strpos(lower(handle), lower(${term})) = 1 THEN 1
        ELSE 2
      END,
      handle ASC
    LIMIT 20
  `

  return rows.map((row) => publicAccount(row))
}

export async function listConversations(accountId) {
  await ensureCommsSchema()
  const sql = database()
  const currentId = normalizeUuid(accountId)
  if (!currentId) return []

  const rows = await sql`
    WITH user_conversations AS (
      SELECT
        c.id,
        c.account_a_id,
        c.account_b_id,
        c.created_at,
        CASE
          WHEN c.account_a_id = ${currentId}::uuid THEN c.account_b_id
          ELSE c.account_a_id
        END AS other_account_id
      FROM wildcard_conversations c
      WHERE c.account_a_id = ${currentId}::uuid
         OR c.account_b_id = ${currentId}::uuid
    ),
    unread AS (
      SELECT
        m.conversation_id,
        count(*)::int AS unread_count
      FROM user_conversations c
      JOIN wildcard_messages m
        ON m.conversation_id = c.id
      LEFT JOIN wildcard_conversation_reads current_read
        ON current_read.conversation_id = c.id
       AND current_read.account_id = ${currentId}::uuid
      WHERE m.sender_account_id <> ${currentId}::uuid
        AND (
          current_read.last_read_message_id IS NULL
          OR (m.created_at, m.id) >
             (current_read.last_read_created_at, current_read.last_read_message_id)
        )
      GROUP BY m.conversation_id
    )
    SELECT
      c.id,
      c.created_at,
      other.id AS other_id,
      other.handle AS other_handle,
      other.display_name AS other_display_name,
      latest.id AS latest_id,
      latest.sender_account_id AS latest_sender_account_id,
      latest.body AS latest_body,
      latest.created_at AS latest_created_at,
      COALESCE(unread.unread_count, 0)::int AS unread_count
    FROM user_conversations c
    JOIN wildcard_accounts other
      ON other.id = c.other_account_id
    LEFT JOIN LATERAL (
      SELECT id, sender_account_id, body, created_at
      FROM wildcard_messages
      WHERE conversation_id = c.id
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    ) latest ON true
    LEFT JOIN unread
      ON unread.conversation_id = c.id
    ORDER BY
      COALESCE(latest.created_at, c.created_at) DESC,
      c.created_at DESC,
      c.id DESC
  `

  return rows.map((row) => ({
    id: row.id,
    otherAccount: publicAccount(row, 'other_'),
    latestMessage: row.latest_id
      ? {
          id: row.latest_id,
          senderAccountId: row.latest_sender_account_id,
          body: row.latest_body,
          createdAt: row.latest_created_at,
        }
      : null,
    unreadCount: Number(row.unread_count) || 0,
  }))
}

export async function openConversation(accountId, otherAccountId) {
  await ensureCommsSchema()
  const sql = database()
  const pair = normalizePair(accountId, otherAccountId)

  if (!pair) {
    const error = new Error('Conversation participants are invalid.')
    error.code = 'INVALID_CONVERSATION_PAIR'
    throw error
  }

  const [accountAId, accountBId] = pair
  const otherId = normalizeUuid(otherAccountId)

  const [candidate] = await sql`
    SELECT
      other.id AS other_id,
      other.handle AS other_handle,
      other.display_name AS other_display_name,
      c.id AS conversation_id
    FROM wildcard_accounts other
    LEFT JOIN wildcard_conversations c
      ON c.account_a_id = ${accountAId}::uuid
     AND c.account_b_id = ${accountBId}::uuid
    WHERE other.id = ${otherId}::uuid
    LIMIT 1
  `

  if (!candidate) {
    const error = new Error('Account not found.')
    error.code = 'ACCOUNT_NOT_FOUND'
    throw error
  }

  const otherAccount = publicAccount(candidate, 'other_')

  if (candidate.conversation_id) {
    return {
      id: candidate.conversation_id,
      otherAccount,
      latestMessage: null,
      unreadCount: 0,
    }
  }

  const conversationId = randomUUID()
  const [created] = await sql`
    INSERT INTO wildcard_conversations (
      id, account_a_id, account_b_id
    )
    VALUES (
      ${conversationId},
      ${accountAId}::uuid,
      ${accountBId}::uuid
    )
    ON CONFLICT (account_a_id, account_b_id) DO NOTHING
    RETURNING id
  `

  if (created?.id) {
    return {
      id: created.id,
      otherAccount,
      latestMessage: null,
      unreadCount: 0,
    }
  }

  const [existing] = await sql`
    SELECT id
    FROM wildcard_conversations
    WHERE account_a_id = ${accountAId}::uuid
      AND account_b_id = ${accountBId}::uuid
    LIMIT 1
  `

  if (!existing?.id) {
    throw new Error('Conversation creation did not resolve to a canonical row.')
  }

  return {
    id: existing.id,
    otherAccount,
    latestMessage: null,
    unreadCount: 0,
  }
}

export async function listMessages({
  accountId,
  conversationId,
  after = '',
  before = '',
}) {
  await ensureCommsSchema()
  const sql = database()
  const currentId = normalizeUuid(accountId)
  const currentConversationId = normalizeUuid(conversationId)
  const afterId = after ? normalizeUuid(after) : ''
  const beforeId = before ? normalizeUuid(before) : ''

  if (!currentId || !currentConversationId) return null

  let rows

  if (afterId) {
    rows = await sql`
      WITH authorized AS (
        SELECT
          id,
          CASE
            WHEN account_a_id = ${currentId}::uuid THEN account_b_id
            ELSE account_a_id
          END AS other_account_id
        FROM wildcard_conversations
        WHERE id = ${currentConversationId}::uuid
          AND (
            account_a_id = ${currentId}::uuid
            OR account_b_id = ${currentId}::uuid
          )
      )
      SELECT
        authorized.id AS authorized_id,
        page.id,
        page.conversation_id,
        page.sender_account_id,
        page.body,
        page.created_at,
        other_read.last_read_message_id AS other_read_message_id,
        other_read.last_read_created_at AS other_read_created_at,
        other_read.read_at AS other_read_read_at
      FROM authorized
      LEFT JOIN LATERAL (
        SELECT
          m.id,
          m.conversation_id,
          m.sender_account_id,
          m.body,
          m.created_at
        FROM wildcard_messages m
        JOIN wildcard_messages cursor
          ON cursor.id = ${afterId}::uuid
         AND cursor.conversation_id = authorized.id
        WHERE m.conversation_id = authorized.id
          AND (m.created_at, m.id) > (cursor.created_at, cursor.id)
        ORDER BY m.created_at ASC, m.id ASC
        LIMIT 50
      ) page ON true
      LEFT JOIN wildcard_conversation_reads other_read
        ON other_read.conversation_id = authorized.id
       AND other_read.account_id = authorized.other_account_id
      ORDER BY page.created_at ASC NULLS FIRST, page.id ASC NULLS FIRST
    `
  } else if (beforeId) {
    rows = await sql`
      WITH authorized AS (
        SELECT
          id,
          CASE
            WHEN account_a_id = ${currentId}::uuid THEN account_b_id
            ELSE account_a_id
          END AS other_account_id
        FROM wildcard_conversations
        WHERE id = ${currentConversationId}::uuid
          AND (
            account_a_id = ${currentId}::uuid
            OR account_b_id = ${currentId}::uuid
          )
      )
      SELECT
        authorized.id AS authorized_id,
        page.id,
        page.conversation_id,
        page.sender_account_id,
        page.body,
        page.created_at,
        other_read.last_read_message_id AS other_read_message_id,
        other_read.last_read_created_at AS other_read_created_at,
        other_read.read_at AS other_read_read_at
      FROM authorized
      LEFT JOIN LATERAL (
        SELECT
          selected.id,
          selected.conversation_id,
          selected.sender_account_id,
          selected.body,
          selected.created_at
        FROM (
          SELECT
            m.id,
            m.conversation_id,
            m.sender_account_id,
            m.body,
            m.created_at
          FROM wildcard_messages m
          JOIN wildcard_messages cursor
            ON cursor.id = ${beforeId}::uuid
           AND cursor.conversation_id = authorized.id
          WHERE m.conversation_id = authorized.id
            AND (m.created_at, m.id) < (cursor.created_at, cursor.id)
          ORDER BY m.created_at DESC, m.id DESC
          LIMIT 50
        ) selected
        ORDER BY selected.created_at ASC, selected.id ASC
      ) page ON true
      LEFT JOIN wildcard_conversation_reads other_read
        ON other_read.conversation_id = authorized.id
       AND other_read.account_id = authorized.other_account_id
      ORDER BY page.created_at ASC NULLS FIRST, page.id ASC NULLS FIRST
    `
  } else {
    rows = await sql`
      WITH authorized AS (
        SELECT
          id,
          CASE
            WHEN account_a_id = ${currentId}::uuid THEN account_b_id
            ELSE account_a_id
          END AS other_account_id
        FROM wildcard_conversations
        WHERE id = ${currentConversationId}::uuid
          AND (
            account_a_id = ${currentId}::uuid
            OR account_b_id = ${currentId}::uuid
          )
      )
      SELECT
        authorized.id AS authorized_id,
        page.id,
        page.conversation_id,
        page.sender_account_id,
        page.body,
        page.created_at,
        other_read.last_read_message_id AS other_read_message_id,
        other_read.last_read_created_at AS other_read_created_at,
        other_read.read_at AS other_read_read_at
      FROM authorized
      LEFT JOIN LATERAL (
        SELECT
          selected.id,
          selected.conversation_id,
          selected.sender_account_id,
          selected.body,
          selected.created_at
        FROM (
          SELECT
            m.id,
            m.conversation_id,
            m.sender_account_id,
            m.body,
            m.created_at
          FROM wildcard_messages m
          WHERE m.conversation_id = authorized.id
          ORDER BY m.created_at DESC, m.id DESC
          LIMIT 50
        ) selected
        ORDER BY selected.created_at ASC, selected.id ASC
      ) page ON true
      LEFT JOIN wildcard_conversation_reads other_read
        ON other_read.conversation_id = authorized.id
       AND other_read.account_id = authorized.other_account_id
      ORDER BY page.created_at ASC NULLS FIRST, page.id ASC NULLS FIRST
    `
  }

  if (rows.length === 0) return null

  return {
    messages: rows.filter((row) => row.id).map(publicMessage),
    otherReadThrough: publicReadState(rows[0], 'other_read_'),
  }
}

export async function totalUnreadCount(accountId) {
  await ensureCommsSchema()
  const sql = database()
  const currentId = normalizeUuid(accountId)
  if (!currentId) return 0

  const [row] = await sql`
    SELECT count(*)::int AS unread_count
    FROM wildcard_messages m
    JOIN wildcard_conversations c
      ON c.id = m.conversation_id
    LEFT JOIN wildcard_conversation_reads current_read
      ON current_read.conversation_id = c.id
     AND current_read.account_id = ${currentId}::uuid
    WHERE (
        c.account_a_id = ${currentId}::uuid
        OR c.account_b_id = ${currentId}::uuid
      )
      AND m.sender_account_id <> ${currentId}::uuid
      AND (
        current_read.last_read_message_id IS NULL
        OR (m.created_at, m.id) >
           (current_read.last_read_created_at, current_read.last_read_message_id)
      )
  `

  return Number(row?.unread_count) || 0
}

export async function markConversationRead({
  accountId,
  conversationId,
  messageId,
}) {
  await ensureCommsSchema()
  const sql = database()
  const currentId = normalizeUuid(accountId)
  const currentConversationId = normalizeUuid(conversationId)
  const currentMessageId = normalizeUuid(messageId)

  if (!currentId || !currentConversationId || !currentMessageId) return null

  const [row] = await sql`
    WITH target AS (
      SELECT
        m.id AS message_id,
        m.created_at
      FROM wildcard_conversations c
      JOIN wildcard_messages m
        ON m.id = ${currentMessageId}::uuid
       AND m.conversation_id = c.id
      WHERE c.id = ${currentConversationId}::uuid
        AND (
          c.account_a_id = ${currentId}::uuid
          OR c.account_b_id = ${currentId}::uuid
        )
      LIMIT 1
    ),
    upsert AS (
      INSERT INTO wildcard_conversation_reads (
        conversation_id,
        account_id,
        last_read_message_id,
        last_read_created_at,
        read_at
      )
      SELECT
        ${currentConversationId}::uuid,
        ${currentId}::uuid,
        target.message_id,
        target.created_at,
        now()
      FROM target
      ON CONFLICT (conversation_id, account_id) DO UPDATE
      SET
        last_read_message_id = EXCLUDED.last_read_message_id,
        last_read_created_at = EXCLUDED.last_read_created_at,
        read_at = now()
      WHERE
        (EXCLUDED.last_read_created_at, EXCLUDED.last_read_message_id) >
        (
          wildcard_conversation_reads.last_read_created_at,
          wildcard_conversation_reads.last_read_message_id
        )
      RETURNING
        last_read_message_id AS message_id,
        last_read_created_at AS created_at,
        read_at
    )
    SELECT message_id, created_at, read_at
    FROM upsert
    UNION ALL
    SELECT
      existing.last_read_message_id AS message_id,
      existing.last_read_created_at AS created_at,
      existing.read_at
    FROM target
    JOIN wildcard_conversation_reads existing
      ON existing.conversation_id = ${currentConversationId}::uuid
     AND existing.account_id = ${currentId}::uuid
    WHERE NOT EXISTS (SELECT 1 FROM upsert)
    LIMIT 1
  `

  return publicReadState(row)
}

export async function createMessage({
  accountId,
  conversationId,
  clientMessageId,
  body,
}) {
  await ensureCommsSchema()
  const sql = database()
  const senderId = normalizeUuid(accountId)
  const currentConversationId = normalizeUuid(conversationId)
  const currentClientMessageId = normalizeUuid(clientMessageId)

  if (!senderId || !currentConversationId || !currentClientMessageId) {
    const error = new Error('Message identifiers are invalid.')
    error.code = 'INVALID_MESSAGE_IDENTIFIERS'
    throw error
  }

  const messageId = randomUUID()
  const [inserted] = await sql`
    INSERT INTO wildcard_messages (
      id,
      conversation_id,
      sender_account_id,
      client_message_id,
      body
    )
    SELECT
      ${messageId},
      c.id,
      ${senderId}::uuid,
      ${currentClientMessageId}::uuid,
      ${body}
    FROM wildcard_conversations c
    WHERE c.id = ${currentConversationId}::uuid
      AND (
        c.account_a_id = ${senderId}::uuid
        OR c.account_b_id = ${senderId}::uuid
      )
    ON CONFLICT (sender_account_id, client_message_id) DO NOTHING
    RETURNING
      id,
      conversation_id,
      sender_account_id,
      body,
      created_at
  `

  if (inserted) {
    return {
      message: publicMessage(inserted),
      replayed: false,
    }
  }

  const [existing] = await sql`
    SELECT
      id,
      conversation_id,
      sender_account_id,
      body,
      created_at
    FROM wildcard_messages
    WHERE sender_account_id = ${senderId}::uuid
      AND client_message_id = ${currentClientMessageId}::uuid
    LIMIT 1
  `

  if (existing) {
    if (
      existing.conversation_id !== currentConversationId ||
      existing.body !== body
    ) {
      const error = new Error('That client message ID was already used for different content.')
      error.code = 'IDEMPOTENCY_CONFLICT'
      throw error
    }

    return {
      message: publicMessage(existing),
      replayed: true,
    }
  }

  const error = new Error('Conversation not found.')
  error.code = 'CONVERSATION_NOT_FOUND'
  throw error
}
