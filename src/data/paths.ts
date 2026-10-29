const isObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Reads a dot path (`order.customer.id`, `items.0.sku`) from a value. */
export const getPath = (value: unknown, path: string): unknown => {
  if (!path) return value
  return path.split('.').reduce<unknown>((current, key) => {
    if (current === null || current === undefined) return undefined
    if (Array.isArray(current)) {
      const index = Number(key)
      return Number.isInteger(index) ? current[index] : undefined
    }
    if (!isObject(current)) return undefined
    return current[key]
  }, value)
}

const setPath = (target: Record<string, unknown>, path: string, value: unknown) => {
  const keys = path.split('.')
  let cursor = target
  for (const key of keys.slice(0, -1)) {
    if (!isObject(cursor[key])) cursor[key] = {}
    cursor = cursor[key] as Record<string, unknown>
  }
  cursor[keys[keys.length - 1]] = value
}

/** Copies only the listed dot paths (plus `id` when present) from a document. */
export const pickPaths = (
  value: Record<string, unknown>,
  paths: string[],
): Record<string, unknown> => {
  const picked: Record<string, unknown> = {}
  if (value.id !== undefined) picked.id = value.id
  for (const path of paths) {
    const fieldValue = getPath(value, path)
    if (fieldValue !== undefined) setPath(picked, path, fieldValue)
  }
  return picked
}

/** Payload `select` object for dot paths: `['a', 'g.b']` → `{ a: true, g: { b: true } }`. */
export const toSelect = (paths: string[]): Record<string, unknown> => {
  const select: Record<string, unknown> = {}
  for (const path of paths) {
    if (path === 'id') continue
    setPath(select, path, true)
  }
  return select
}

/** Normalizes a relationship value (ID, populated doc, polymorphic `{ relationTo, value }`) to an ID. */
export const toRelationId = (value: unknown): string | number | undefined => {
  if (typeof value === 'string' || typeof value === 'number') return value
  if (!isObject(value)) return undefined
  if ('value' in value && 'relationTo' in value) return toRelationId(value.value)
  const id = value.id
  return typeof id === 'string' || typeof id === 'number' ? id : undefined
}

export { isObject }
