import type { Payload } from 'payload'
import type { NormalizedNotificationsPluginOptions } from '../types'
import { DELIVERY_STATUSES } from '../collections/NotificationDeliveries'

type DrizzleLikeAdapter = {
  execute?: (args: { drizzle: unknown; raw: string }) => unknown
  drizzle?: unknown
  tableNameMap?: Map<string, string>
  schemaName?: string
}

type MongooseModelLike = {
  findOneAndUpdate?: (filter: unknown, update: unknown) => PromiseLike<unknown>
}

const STATUSES = new Set<string>(DELIVERY_STATUSES)

const toSnakeCase = (value: string) =>
  value
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[-\s]+/g, '_')
    .toLowerCase()

const quoteIdent = (value: string) => `"${value.replace(/"/g, '""')}"`

/** Inlines an ID: integers as numbers, UUID / text IDs as quoted literals (safe characters only). */
const sqlId = (id: string): string | undefined => {
  if (/^\d+$/.test(id)) return id
  if (/^[\w-]+$/.test(id)) return `'${id}'`
  return undefined
}

/** Rows changed by a raw `UPDATE … RETURNING`, across libSQL, D1, better-sqlite3 and node-postgres. */
const changedRows = (result: unknown): number | undefined => {
  if (Array.isArray(result)) return result.length
  if (!result || typeof result !== 'object') return undefined
  const value = result as {
    rowsAffected?: number
    rowCount?: number | null
    changes?: number
    meta?: { changes?: number }
    rows?: unknown[]
    results?: unknown[]
  }
  // The returned rows first: libSQL reports `rowsAffected: 0` for `UPDATE … RETURNING`.
  if (Array.isArray(value.rows)) return value.rows.length
  if (Array.isArray(value.results)) return value.results.length
  for (const count of [value.rowsAffected, value.rowCount, value.meta?.changes, value.changes]) {
    if (typeof count === 'number') return count
  }
  return undefined
}

/**
 * One `UPDATE … SET status = to WHERE id = ? AND status = from` on a SQL adapter
 * (Postgres, SQLite, D1). Undefined when the adapter or result shape isn't recognised.
 */
const claimWithSql = async (
  payload: Payload,
  slug: string,
  id: string,
  from: string,
  to: string,
): Promise<boolean | undefined> => {
  const db = payload.db as unknown as DrizzleLikeAdapter | undefined
  if (typeof db?.execute !== 'function' || !db.drizzle || !db.tableNameMap) return undefined
  const table = db.tableNameMap.get(toSnakeCase(slug))
  const idLiteral = sqlId(id)
  if (!table || !idLiteral) return undefined
  const target = db.schemaName
    ? `${quoteIdent(db.schemaName)}.${quoteIdent(table)}`
    : quoteIdent(table)
  const raw =
    `UPDATE ${target} SET "status" = '${to}' ` +
    `WHERE "id" = ${idLiteral} AND "status" = '${from}' RETURNING "id"`
  const changed = changedRows(await db.execute({ drizzle: db.drizzle, raw }))
  return changed === undefined ? undefined : changed > 0
}

/** `findOneAndUpdate({ _id, status: from })` on the Mongoose adapter, or undefined. */
const claimWithMongo = async (
  payload: Payload,
  slug: string,
  id: string,
  from: string,
  to: string,
): Promise<boolean | undefined> => {
  const model = (payload.db as unknown as { collections?: Record<string, MongooseModelLike> })
    ?.collections?.[slug]
  if (typeof model?.findOneAndUpdate !== 'function') return undefined
  const previous = await model.findOneAndUpdate({ _id: id, status: from }, { $set: { status: to } })
  return Boolean(previous)
}

/**
 * Compare-and-set on a delivery's status: moves it from `from` to `to` only if it is still
 * `from`, in one database operation, and returns whether this caller won. Two send jobs for
 * one delivery (a reconcile re-queue next to the original job, say) then can't both act on
 * it: the loser sees `false` and stops.
 *
 * SQL adapters run one conditional `UPDATE … RETURNING`; MongoDB uses `findOneAndUpdate`.
 * Other adapters (and the in-memory test double) use a filtered `payload.update`, which is
 * only as atomic as the adapter makes it. Only the status changes here: set other fields
 * with a normal update afterwards.
 */
export const claimDeliveryStatus = async ({
  payload,
  options,
  deliveryId,
  from,
  to,
}: {
  payload: Payload
  options: Pick<NormalizedNotificationsPluginOptions, 'collections'>
  deliveryId: string
  from: string
  to: string
}): Promise<boolean> => {
  if (!STATUSES.has(from) || !STATUSES.has(to)) {
    throw new Error(`payload-notifications: unknown delivery status ${from} -> ${to}`)
  }
  const slug = options.collections.deliveries
  try {
    const viaSql = await claimWithSql(payload, slug, deliveryId, from, to)
    if (viaSql !== undefined) return viaSql
    const viaMongo = await claimWithMongo(payload, slug, deliveryId, from, to)
    if (viaMongo !== undefined) return viaMongo
  } catch (error) {
    payload.logger?.warn?.(
      `payload-notifications: atomic status update failed, using a filtered update: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }
  const result = (await payload.update({
    collection: slug as never,
    where: {
      and: [{ id: { equals: deliveryId } }, { status: { equals: from } }],
    } as never,
    data: { status: to } as never,
    overrideAccess: true,
  })) as { docs?: unknown[] }
  return (result.docs?.length ?? 0) > 0
}
