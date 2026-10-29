import type { NotificationEventSchema, StandardSchemaV1Like } from '../types'

export type SchemaCheckResult = { ok: true; value: unknown } | { ok: false; message: string }

const isStandardSchema = (schema: unknown): schema is StandardSchemaV1Like => {
  return (
    typeof schema === 'object' &&
    schema !== null &&
    typeof (schema as Record<string, unknown>)['~standard'] === 'object'
  )
}

export const isSchemaLike = (schema: unknown): schema is NotificationEventSchema => {
  return typeof schema === 'function' || isStandardSchema(schema)
}

const formatIssuePath = (
  path: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }> | undefined,
): string => {
  if (!path?.length) return ''
  return path
    .map((segment) => (typeof segment === 'object' ? String(segment.key) : String(segment)))
    .join('.')
}

/**
 * Runs a Standard Schema or validator function. Validator functions return the
 * (optionally transformed) value or throw.
 */
export const checkSchema = async (
  schema: NotificationEventSchema,
  value: unknown,
): Promise<SchemaCheckResult> => {
  if (isStandardSchema(schema)) {
    const result = await schema['~standard'].validate(value)
    if (result.issues) {
      const message = result.issues
        .map((issue) => {
          const path = formatIssuePath(issue.path)
          return path ? `${path}: ${issue.message}` : issue.message
        })
        .join('; ')
      return { ok: false, message }
    }
    return { ok: true, value: result.value }
  }

  try {
    return { ok: true, value: await schema(value as Record<string, unknown>) }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}
