import { isObject } from './paths'

/** Field names never exposed to templates, previews or logs (case-insensitive). */
export const SENSITIVE_FIELD_NAMES = [
  'password',
  'hash',
  'salt',
  'resetPasswordToken',
  'resetPasswordExpiration',
  '_verificationToken',
  'apiKey',
  'apiKeyIndex',
  'loginAttempts',
  'lockUntil',
  'sessions',
]

/** Substrings that mark a field name as sensitive (case-insensitive). */
export const SENSITIVE_FIELD_PATTERNS = ['token', 'secret']

export const REDACTED = '[redacted]'

export type SensitiveFieldMatcher = (key: string) => boolean

export const createSensitiveFieldMatcher = (extra: string[] = []): SensitiveFieldMatcher => {
  const names = new Set([...SENSITIVE_FIELD_NAMES, ...extra].map((name) => name.toLowerCase()))
  return (key: string) => {
    const lower = key.toLowerCase()
    return names.has(lower) || SENSITIVE_FIELD_PATTERNS.some((pattern) => lower.includes(pattern))
  }
}

export const defaultSensitiveFieldMatcher = createSensitiveFieldMatcher()

/** True when any segment of a dot path is a sensitive field name. */
export const isSensitivePath = (
  path: string,
  isSensitive: SensitiveFieldMatcher = defaultSensitiveFieldMatcher,
): boolean => path.split('.').some(isSensitive)

/** Deep copy of `value` without sensitive keys. Used on every lookup and resolver result. */
export const stripSensitiveFields = (
  value: unknown,
  isSensitive: SensitiveFieldMatcher = defaultSensitiveFieldMatcher,
  depth = 0,
): unknown => {
  if (depth > 10) return undefined
  if (Array.isArray(value)) {
    return value.map((item) => stripSensitiveFields(item, isSensitive, depth + 1))
  }
  if (!isObject(value) || value instanceof Date) return value

  const result: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value)) {
    if (isSensitive(key)) continue
    result[key] = stripSensitiveFields(child, isSensitive, depth + 1)
  }
  return result
}

const redactPath = (target: unknown, keys: string[]) => {
  if (!keys.length || target === null || typeof target !== 'object') return
  const [key, ...rest] = keys

  if (Array.isArray(target)) {
    const items = key === '*' ? target.map((_, index) => index) : [Number(key)]
    for (const index of items) {
      if (!Number.isInteger(index) || index >= target.length) continue
      if (rest.length) redactPath(target[index], rest)
      else target[index] = REDACTED
    }
    return
  }

  const record = target as Record<string, unknown>
  if (!(key in record)) {
    // Paths through arrays without an index apply to every item: `items.sku`.
    return
  }
  if (rest.length) {
    if (Array.isArray(record[key]) && !/^\d+$|^\*$/.test(rest[0])) {
      for (const item of record[key] as unknown[]) redactPath(item, rest)
    } else {
      redactPath(record[key], rest)
    }
  } else if (record[key] !== undefined && record[key] !== null) {
    record[key] = REDACTED
  }
}

/**
 * Copy of a context for previews, inspectors and logs: sensitive keys are
 * replaced by `[redacted]` and every configured `data.redact` path is masked.
 */
export const redactContext = <T>(
  value: T,
  paths: string[] = [],
  isSensitive: SensitiveFieldMatcher = defaultSensitiveFieldMatcher,
): T => {
  const maskSensitive = (input: unknown, depth: number): unknown => {
    if (depth > 10) return REDACTED
    if (Array.isArray(input)) return input.map((item) => maskSensitive(item, depth + 1))
    if (!isObject(input) || input instanceof Date) return input
    const result: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(input)) {
      result[key] = isSensitive(key) ? REDACTED : maskSensitive(child, depth + 1)
    }
    return result
  }

  const copy = maskSensitive(value, 0)
  for (const path of paths) redactPath(copy, path.split('.'))
  return copy as T
}
