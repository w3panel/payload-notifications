/** Postgres `unique_violation`. */
const PG_UNIQUE_VIOLATION = '23505'
/** SQLite / libSQL extended result codes for a unique or primary-key violation. */
const SQLITE_UNIQUE_CODES = new Set<unknown>([
  'SQLITE_CONSTRAINT_UNIQUE',
  'SQLITE_CONSTRAINT_PRIMARYKEY',
  2067,
  1555,
])
/** MongoDB duplicate key. */
const MONGO_DUPLICATE_KEY = 11000

/**
 * The drivers' own unique-violation wording: Postgres, SQLite / libSQL / D1, MongoDB.
 * Deliberately not "duplicate" on its own, which also appears in ordinary text.
 */
const UNIQUE_MESSAGE =
  /duplicate key value violates unique constraint|UNIQUE constraint failed|E11000 duplicate key/i

/**
 * drizzle's wrapper ("Failed query: insert … params: …") quotes the inserted values, which
 * can contain any text: never judge it by its message, only by its `cause`.
 */
const QUERY_WRAPPER = /^Failed query:/

type ErrorLike = {
  message?: unknown
  code?: unknown
  extendedCode?: unknown
  rawCode?: unknown
  cause?: unknown
  data?: { errors?: Array<{ message?: unknown }> }
}

const matchesOne = (value: ErrorLike): boolean => {
  if (value.code === PG_UNIQUE_VIOLATION || value.code === MONGO_DUPLICATE_KEY) return true
  for (const code of [value.code, value.extendedCode, value.rawCode]) {
    if (SQLITE_UNIQUE_CODES.has(code)) return true
  }
  const message = typeof value.message === 'string' ? value.message : ''
  if (message && !QUERY_WRAPPER.test(message) && UNIQUE_MESSAGE.test(message)) return true
  // Payload's SQL adapters rethrow a unique violation as a ValidationError whose field
  // errors say "Value must be unique".
  const errors = value.data?.errors
  return (
    Array.isArray(errors) &&
    errors.some((entry) => /must be unique/i.test(String(entry?.message ?? '')))
  )
}

/**
 * True for unique-constraint violations from any Payload database adapter:
 * Postgres (code `23505`), SQLite / libSQL / Cloudflare D1 (`SQLITE_CONSTRAINT_UNIQUE`,
 * "UNIQUE constraint failed"), MongoDB (code `11000`, "E11000 duplicate key"), and
 * Payload's `ValidationError` "Value must be unique". Follows `cause` chains; drizzle's
 * "Failed query: …" wrapper is judged by its cause only.
 */
export const isDuplicateKeyError = (error: unknown): boolean => {
  let current: unknown = error
  for (let depth = 0; depth < 5 && current !== undefined && current !== null; depth++) {
    if (typeof current !== 'object') {
      return !QUERY_WRAPPER.test(String(current)) && UNIQUE_MESSAGE.test(String(current))
    }
    if (matchesOne(current as ErrorLike)) return true
    current = (current as ErrorLike).cause
  }
  return false
}
