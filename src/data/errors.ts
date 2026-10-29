/**
 * True for unique-constraint violations from any Payload database adapter:
 * MongoDB (`E11000 duplicate key`), Postgres / SQLite (drizzle reports a
 * ValidationError whose field errors say the value must be unique).
 */
export const isDuplicateKeyError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error)
  if (/duplicate|already exists|E11000|UNIQUE constraint/i.test(message)) return true
  const errors = (error as { data?: { errors?: Array<{ message?: unknown }> } } | null)?.data
    ?.errors
  return (
    Array.isArray(errors) && errors.some((entry) => /unique/i.test(String(entry?.message ?? '')))
  )
}
