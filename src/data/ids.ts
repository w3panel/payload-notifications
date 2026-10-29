import type { Payload } from 'payload'

/**
 * A relationship value in the target collection's ID type. Jobs and inputs
 * carry IDs as strings, but SQL adapters use numeric IDs by default and reject
 * `"12"` for a relationship to a numeric ID.
 */
export const toRelationId = (
  payload: Payload,
  collection: string,
  value: string | number | null | undefined,
): string | number | null | undefined => {
  if (value === null || value === undefined || value === '') return value
  const custom = (payload.collections as Record<string, { customIDType?: string }> | undefined)?.[
    collection
  ]?.customIDType
  const idType = custom ?? (payload.db as { defaultIDType?: string } | undefined)?.defaultIDType
  if (idType === 'number') {
    const numeric = typeof value === 'number' ? value : Number(value)
    return Number.isFinite(numeric) && String(numeric) === String(value).trim() ? numeric : value
  }
  return idType === 'text' ? String(value) : value
}
