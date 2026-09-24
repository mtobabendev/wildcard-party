import { neon } from '@neondatabase/serverless'

export function database() {
  if (!process.env.DATABASE_URL) {
    const error = new Error('DATABASE_URL is not configured.')
    error.code = 'DATABASE_NOT_CONFIGURED'
    throw error
  }

  return neon(process.env.DATABASE_URL)
}

export function databaseNotConfigured(error) {
  return error?.code === 'DATABASE_NOT_CONFIGURED'
}
