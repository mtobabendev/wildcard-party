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

function publicAttachment(row, prefix = '') {
  const id = row?.[`${prefix}attachment_id`]
  if (!id) return null

  const contentType = row[`${prefix}attachment_content_type`]

  return {
    id,
    name: row[`${prefix}attachment_original_name`],
    contentType,
    size: Number(row[`${prefix}attachment_byte_size`]) || 0,
    isImage: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(contentType),
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
    attachment: publicAttachment(row),
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

function publicPresence(row, prefix = '') {
  return {
    isOnline: Boolean(row?.[`${prefix}is_online`]),
    lastActiveAt: row?.[`${prefix}last_active_at`] || null,
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
        DO $
        DECLARE
          old_constraint text;
        BEGIN
          FOR old_constraint IN
            SELECT conname
            FROM pg_constraint
            WHERE conrelid = 'wildcard_messages'::regclass
              AND contype = 'c'
              AND conname <> 'wildcard_messages_body_length_check'
              AND pg_get_constraintdef(oid) ILIKE '%char_length(body)%'
          LOOP
            EXECUTE format(
              'ALTER TABLE wildcard_messages DROP CONSTRAINT %I',
              old_constraint
            );
          END LOOP;

          IF NOT EXISTS (
            SELECT 1
            FROM pg_constraint
            WHERE conrelid = 'wildcard_messages'::regclass
              AND conname = 'wildcard_messages_body_length_check'
          ) THEN
            ALTER TABLE wildcard_messages
              ADD CONSTRAINT wildcard_messages_body_length_check
              CHECK (char_length(body) BETWEEN 0 AND 4000);
          END IF;
        END
        $
      `

      await sql`
        CREATE TABLE IF NOT EXISTS wildcard_message_attachments (
          id uuid PRIMARY KEY,
          message_id uuid NOT NULL UNIQUE
            REFERENCES wildcard_messages(id) ON DELETE CASCADE,
          uploader_account_id uuid NOT NULL
            REFERENCES wildcard_accounts(id) ON DELETE CASCADE,
          storage_key text NOT NULL UNIQUE,
          original_name varchar(180) NOT NULL,
          content_type varchar(160) NOT NULL,
          byte_size bigint NOT NULL
            CHECK (byte_size BETWEEN 1 AND 10485760),
          created_at timestamptz NOT NULL DEFAULT now()
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
        CREATE TABLE IF NOT EXISTS wildcard_account_presence (
          account_id uuid PRIMARY KEY
            REFERENCES wildcard_accounts(id) ON DELETE CASCADE,
          last_active_at timestamptz NOT NULL DEFAULT now()
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

export async function touchPresence(accountId) {
  await ensureCommsSchema()
  const sql = database()
  const currentId = normalizeUuid(accountId)
  if (!currentId) return null

  const [row] = await sql`
    INSERT INTO wildcard_account_presence (
      account_id,
      last_active_at
    )
    VALUES (
      ${currentId}::uuid,
      now()
    )
    ON CONFLICT (account_id) DO UPDATE
    SET last_active_at = now()
    RETURNING last_active_at
  `

  return row?.last_active_at
    ? { lastActiveAt: row.last_active_at }
    : null
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

export async function conversationParticipantExists(accountId, conversationId) {
  await ensureCommsSchema()
  const sql = database()
  const currentId = normalizeUuid(accountId)
  const currentConversationId = normalizeUuid(conversationId)

  if (!currentId || !currentConversationId) return false

  const [row] = await sql`
    SELECT id
    FROM wildcard_conversations
    WHERE id = ${currentConversationId}::uuid
      AND (
        account_a_id = ${currentId}::uuid
        OR account_b_id = ${currentId}::uuid
      )
    LIMIT 1
  `

  return Boolean(row?.id)
}

export async function getAttachmentForParticipant(accountId, attachmentId) {
  await ensureCommsSchema()
  const sql = database()
  const currentId = normalizeUuid(accountId)
  const currentAttachmentId = normalizeUuid(attachmentId)

  if (!currentId || !currentAttachmentId) return null

  const [row] = await sql`
    SELECT
      attachment.id,
      attachment.storage_key,
      attachment.original_name,
      attachment.content_type,
      attachment.byte_size
    FROM wildcard_message_attachments attachment
    JOIN wildcard_messages message
      ON message.id = attachment.message_id
    JOIN wildcard_conversations conversation
      ON conversation.id = message.conversation_id
    WHERE attachment.id = ${currentAttachmentId}::uuid
      AND (
        conversation.account_a_id = ${currentId}::uuid
        OR conversation.account_b_id = ${currentId}::uuid
      )
    LIMIT 1
  `

  if (!row?.id) return null

  return {
    id: row.id,
    storageKey: row.storage_key,
    name: row.original_name,
    contentType: row.content_type,
    size: Number(row.byte_size) || 0,
  }
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
      latest.attachment_id AS latest_attachment_id,
      latest.attachment_original_name AS latest_attachment_original_name,
      latest.attachment_content_type AS latest_attachment_content_type,
      latest.attachment_byte_size AS latest_attachment_byte_size,
      COALESCE(unread.unread_count, 0)::int AS unread_count,
      presence.last_active_at AS other_last_active_at,
      (
        presence.last_active_at >= now() - interval '90 seconds'
      ) AS other_is_online
    FROM user_conversations c
    JOIN wildcard_accounts other
      ON other.id = c.other_account_id
    LEFT JOIN LATERAL (
      SELECT
        m.id,
        m.sender_account_id,
        m.body,
        m.created_at,
        attachment.id AS attachment_id,
        attachment.original_name AS attachment_original_name,
        attachment.content_type AS attachment_content_type,
        attachment.byte_size AS attachment_byte_size
      FROM wildcard_messages m
      LEFT JOIN wildcard_message_attachments attachment
        ON attachment.message_id = m.id
      WHERE m.conversation_id = c.id
      ORDER BY m.created_at DESC, m.id DESC
      LIMIT 1
    ) latest ON true
    LEFT JOIN unread
      ON unread.conversation_id = c.id
    LEFT JOIN wildcard_account_presence presence
      ON presence.account_id = c.other_account_id
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
          attachment: publicAttachment(row, 'latest_'),
        }
      : null,
    unreadCount: Number(row.unread_count) || 0,
    otherPresence: publicPresence(row, 'other_'),
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
      c.id AS conversation_id,
      presence.last_active_at AS other_last_active_at,
      (
        presence.last_active_at >= now() - interval '90 seconds'
      ) AS other_is_online
    FROM wildcard_accounts other
    LEFT JOIN wildcard_conversations c
      ON c.account_a_id = ${accountAId}::uuid
     AND c.account_b_id = ${accountBId}::uuid
    LEFT JOIN wildcard_account_presence presence
      ON presence.account_id = other.id
    WHERE other.id = ${otherId}::uuid
    LIMIT 1
  `

  if (!candidate) {
    const error = new Error('Account not found.')
    error.code = 'ACCOUNT_NOT_FOUND'
    throw error
  }

  const otherAccount = publicAccount(candidate, 'other_')
  const otherPresence = publicPresence(candidate, 'other_')

  if (candidate.conversation_id) {
    return {
      id: candidate.conversation_id,
      otherAccount,
      latestMessage: null,
      unreadCount: 0,
      otherPresence,
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
      otherPresence,
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
    otherPresence,
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
        attachment.id AS attachment_id,
        attachment.original_name AS attachment_original_name,
        attachment.content_type AS attachment_content_type,
        attachment.byte_size AS attachment_byte_size,
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
      LEFT JOIN wildcard_message_attachments attachment
        ON attachment.message_id = page.id
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
        attachment.id AS attachment_id,
        attachment.original_name AS attachment_original_name,
        attachment.content_type AS attachment_content_type,
        attachment.byte_size AS attachment_byte_size,
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
      LEFT JOIN wildcard_message_attachments attachment
        ON attachment.message_id = page.id
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
        attachment.id AS attachment_id,
        attachment.original_name AS attachment_original_name,
        attachment.content_type AS attachment_content_type,
        attachment.byte_size AS attachment_byte_size,
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
      LEFT JOIN wildcard_message_attachments attachment
        ON attachment.message_id = page.id
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
  attachment = null,
}) {
  await ensureCommsSchema()
  const sql = database()
  const senderId = normalizeUuid(accountId)
  const currentConversationId = normalizeUuid(conversationId)
  const currentClientMessageId = normalizeUuid(clientMessageId)
  const attachmentKey = typeof attachment?.storageKey === 'string'
    ? attachment.storageKey
    : ''

  if (!senderId || !currentConversationId || !currentClientMessageId) {
    const error = new Error('Message identifiers are invalid.')
    error.code = 'INVALID_MESSAGE_IDENTIFIERS'
    throw error
  }

  const loadExisting = async () => {
    const [existing] = await sql`
      SELECT
        message.id,
        message.conversation_id,
        message.sender_account_id,
        message.body,
        message.created_at,
        attachment.id AS attachment_id,
        attachment.storage_key AS attachment_storage_key,
        attachment.original_name AS attachment_original_name,
        attachment.content_type AS attachment_content_type,
        attachment.byte_size AS attachment_byte_size
      FROM wildcard_messages message
      LEFT JOIN wildcard_message_attachments attachment
        ON attachment.message_id = message.id
      WHERE message.sender_account_id = ${senderId}::uuid
        AND message.client_message_id = ${currentClientMessageId}::uuid
      LIMIT 1
    `

    return existing || null
  }

  const replayExisting = (existing) => {
    if (!existing) return null

    const existingAttachmentKey = existing.attachment_storage_key || ''
    if (
      existing.conversation_id !== currentConversationId ||
      existing.body !== body ||
      existingAttachmentKey !== attachmentKey
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

  const existing = await loadExisting()
  if (existing) return replayExisting(existing)

  const messageId = randomUUID()
  const attachmentId = attachmentKey ? randomUUID() : null

  let inserted
  try {
    ;[inserted] = await sql`
      WITH authorized AS (
        SELECT id
        FROM wildcard_conversations
        WHERE id = ${currentConversationId}::uuid
          AND (
            account_a_id = ${senderId}::uuid
            OR account_b_id = ${senderId}::uuid
          )
      ),
      inserted_message AS (
        INSERT INTO wildcard_messages (
          id,
          conversation_id,
          sender_account_id,
          client_message_id,
          body
        )
        SELECT
          ${messageId},
          authorized.id,
          ${senderId}::uuid,
          ${currentClientMessageId}::uuid,
          ${body}
        FROM authorized
        ON CONFLICT (sender_account_id, client_message_id) DO NOTHING
        RETURNING
          id,
          conversation_id,
          sender_account_id,
          body,
          created_at
      ),
      inserted_attachment AS (
        INSERT INTO wildcard_message_attachments (
          id,
          message_id,
          uploader_account_id,
          storage_key,
          original_name,
          content_type,
          byte_size
        )
        SELECT
          ${attachmentId}::uuid,
          inserted_message.id,
          ${senderId}::uuid,
          ${attachmentKey},
          ${attachment?.name || ''},
          ${attachment?.contentType || ''},
          ${attachment?.size || 0}
        FROM inserted_message
        WHERE ${Boolean(attachmentKey)}
        RETURNING
          id,
          message_id,
          storage_key,
          original_name,
          content_type,
          byte_size
      )
      SELECT
        inserted_message.id,
        inserted_message.conversation_id,
        inserted_message.sender_account_id,
        inserted_message.body,
        inserted_message.created_at,
        inserted_attachment.id AS attachment_id,
        inserted_attachment.storage_key AS attachment_storage_key,
        inserted_attachment.original_name AS attachment_original_name,
        inserted_attachment.content_type AS attachment_content_type,
        inserted_attachment.byte_size AS attachment_byte_size
      FROM inserted_message
      LEFT JOIN inserted_attachment
        ON inserted_attachment.message_id = inserted_message.id
    `
  } catch (error) {
    if (error?.code === '23505') {
      const conflict = new Error('That attachment or client message ID is already registered.')
      conflict.code = 'IDEMPOTENCY_CONFLICT'
      throw conflict
    }
    throw error
  }

  if (inserted) {
    return {
      message: publicMessage(inserted),
      replayed: false,
    }
  }

  const racedExisting = await loadExisting()
  if (racedExisting) return replayExisting(racedExisting)

  const error = new Error('Conversation not found.')
  error.code = 'CONVERSATION_NOT_FOUND'
  throw error
}
