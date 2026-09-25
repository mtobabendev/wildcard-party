import { randomUUID } from 'node:crypto'
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

export const MAX_ATTACHMENT_BYTES = 10485760

export const ALLOWED_ATTACHMENT_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/json',
  'application/zip',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
])

export const INLINE_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
])

let storageClient

function storageConfig() {
  const endpoint = process.env.AWS_ENDPOINT_URL_S3
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY
  const region = process.env.AWS_REGION
  const bucket = process.env.NEON_STORAGE_BUCKET

  if (!endpoint || !accessKeyId || !secretAccessKey || !region || !bucket) {
    const error = new Error('Private COMMS storage is not configured for this runtime.')
    error.code = 'STORAGE_NOT_CONFIGURED'
    throw error
  }

  return {
    endpoint,
    region,
    bucket,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  }
}

function clientAndBucket() {
  const config = storageConfig()

  if (!storageClient) {
    storageClient = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      credentials: config.credentials,
      forcePathStyle: true,
    })
  }

  return {
    client: storageClient,
    bucket: config.bucket,
  }
}

export function sanitizeAttachmentName(value) {
  const source = typeof value === 'string' ? value : ''
  const basename = source.split(/[\\/]/).pop() || ''
  const cleaned = basename
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180)

  return cleaned || 'attachment'
}

export function isAllowedAttachmentType(value) {
  return typeof value === 'string' && ALLOWED_ATTACHMENT_TYPES.has(value.toLowerCase())
}

export function isInlineImageType(value) {
  return typeof value === 'string' && INLINE_IMAGE_TYPES.has(value.toLowerCase())
}

export function attachmentNamespace(conversationId, accountId) {
  return `comms/${conversationId}/${accountId}/`
}

export function attachmentKeyBelongsTo({
  key,
  conversationId,
  accountId,
  originalName = '',
}) {
  if (typeof key !== 'string') return false

  const prefix = attachmentNamespace(conversationId, accountId)
  if (!key.startsWith(prefix)) return false

  if (originalName) {
    const safeName = sanitizeAttachmentName(originalName)
    if (!key.endsWith(`-${safeName}`)) return false
  }

  return true
}

export async function createAttachmentUpload({
  conversationId,
  accountId,
  originalName,
  contentType,
}) {
  const { client, bucket } = clientAndBucket()
  const safeName = sanitizeAttachmentName(originalName)
  const key = `${attachmentNamespace(conversationId, accountId)}${randomUUID()}-${safeName}`

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: contentType,
  })

  const url = await getSignedUrl(client, command, {
    expiresIn: 60,
    signableHeaders: new Set(['content-type']),
  })

  return {
    key,
    url,
    expiresIn: 60,
  }
}

export async function verifyUploadedAttachment({
  key,
  conversationId,
  accountId,
  originalName,
}) {
  if (!attachmentKeyBelongsTo({
    key,
    conversationId,
    accountId,
    originalName,
  })) {
    const error = new Error('Attachment storage key is outside the authorized COMMS namespace.')
    error.code = 'ATTACHMENT_KEY_INVALID'
    throw error
  }

  const { client, bucket } = clientAndBucket()
  let metadata

  try {
    metadata = await client.send(new HeadObjectCommand({
      Bucket: bucket,
      Key: key,
    }))
  } catch (cause) {
    const error = new Error('Uploaded attachment could not be verified.')
    error.code = 'ATTACHMENT_NOT_FOUND'
    error.cause = cause
    throw error
  }

  const contentType = typeof metadata.ContentType === 'string'
    ? metadata.ContentType.toLowerCase()
    : ''
  const size = Number(metadata.ContentLength)

  if (!isAllowedAttachmentType(contentType)) {
    const error = new Error('Uploaded attachment type is not allowed.')
    error.code = 'ATTACHMENT_TYPE_INVALID'
    throw error
  }

  if (!Number.isSafeInteger(size) || size < 1 || size > MAX_ATTACHMENT_BYTES) {
    const error = new Error('Uploaded attachment size is outside the allowed range.')
    error.code = 'ATTACHMENT_SIZE_INVALID'
    throw error
  }

  return {
    storageKey: key,
    name: sanitizeAttachmentName(originalName),
    contentType,
    size,
    isImage: isInlineImageType(contentType),
  }
}

function responseDisposition(name, isImage) {
  const disposition = isImage ? 'inline' : 'attachment'
  return `${disposition}; filename*=UTF-8''${encodeURIComponent(sanitizeAttachmentName(name))}`
}

export async function createAttachmentDownload({
  storageKey,
  name,
  contentType,
}) {
  const { client, bucket } = clientAndBucket()
  const isImage = isInlineImageType(contentType)

  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: storageKey,
    ResponseContentDisposition: responseDisposition(name, isImage),
    ResponseContentType: contentType,
    ResponseCacheControl: 'private, no-store',
  })

  const url = await getSignedUrl(client, command, { expiresIn: 60 })

  return {
    url,
    expiresIn: 60,
  }
}
