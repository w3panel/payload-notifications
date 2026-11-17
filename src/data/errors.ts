/** Postgres `unique_violation`. */
const PG_UNIQUE_VIOLATION = '23505'
/** SQLite / libSQL extended result codes for a unique or primary-key violation. */
const SQLITE_UNIQUE_CODES = new Set([
  'SQLITE_CONSTRAINT_UNIQUE',
  'SQLITE_CONSTRAINT_PRIMARYKEY',
  2067,
  1555,
])

/** Everything 0.4.0-beta.4 matched, plus the Postgres constraint wording. */
const UNIQUE_MESSAGE = /duplicate|already exists|E11000|UNIQUE constraint|unique_violation/i

type ErrorLike = {
  message?: unknown
  code?: unknown
  extendedCode?: unknown
  rawCode?: unknown
  cause?: unknown
  data?: { errors?: Array<{ message?: unknown }> }
}

const matchesOne = (error: unknown): boolean => {
  if (error === null || error === undefined) return false
  if (typeof error !== 'object') return UNIQUE_MESSAGE.test(String(error))
  const value = error as ErrorLike
  if (value.code === PG_UNIQUE_VIOLATION) return true
  for (const code of [value.code, value.extendedCode, value.rawCode]) {
    if (SQLITE_UNIQUE_CODES.has(code as string | number)) return true
  }
  // `SQLITE_CONSTRAINT` alone also covers NOT NULL / CHECK / foreign keys: need the message.
  if (typeof value.message === 'string' && UNIQUE_MESSAGE.test(value.message)) return true
  // Payload's Postgres / SQLite adapters rethrow as a ValidationError: "Value must be unique".
  const errors = value.data?.errors
  return (
    Array.isArray(errors) && errors.some((entry) => /unique/i.test(String(entry?.message ?? '')))
  )
}

/**
 * True for unique-constraint violations from any Payload database adapter:
 * Postgres (`23505`, "duplicate key value violates unique constraint"),
 * SQLite / libSQL / Cloudflare D1 ("UNIQUE constraint failed", `SQLITE_CONSTRAINT_UNIQUE`),
 * MongoDB (`E11000 duplicate key`), and Payload's `ValidationError` whose field
 * errors say the value must be unique. Follows `cause` chains (drizzle wraps the
 * driver error in "Failed query: …").
 */
export const isDuplicateKeyError = (error: unknown): boolean => {
  let current: unknown = error
  for (let depth = 0; depth < 5 && current !== undefined && current !== null; depth++) {
    if (matchesOne(current)) return true
    current = typeof current === 'object' ? (current as ErrorLike).cause : undefined
  }
  return false
}
