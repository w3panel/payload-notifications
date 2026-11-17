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

/** Fields a claim may set together with the status (one write, no second round trip). */
export type DeliveryClaimFields = {
  attempts?: number
  maxAttempts?: number
  lastError?: string | null
  skipReason?: string | null
}

/** SQL column for each claim field (Payload snake-cases field names). */
const COLUMNS: Record<keyof DeliveryClaimFields, string> = {
  attempts: 'attempts',
  maxAttempts: 'max_attempts',
  lastError: 'last_error',
  skipReason: 'skip_reason',
}

const STATUSES = new Set<string>(DELIVERY_STATUSES)

const quoteIdent = (value: string) => `"${value.replace(/"/g, '""')}"`

/** A SQL string literal (standard quoting: Postgres and SQLite). */
const quoteText = (value: string) => `'${value.replace(/'/g, "''")}'`

/** Inlines an ID: integers as numbers, UUID / text IDs as quoted literals (safe characters only). */
const sqlId = (id: string): string | undefined => {
  if (/^\d+$/.test(id)) return id
  if (/^[\w-]+$/.test(id)) return `'${id}'`
  return undefined
}

const sqlValue = (value: string | number | null): string | undefined => {
  if (value === null) return 'NULL'
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : undefined
  return quoteText(value)
}

const squash = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '')

/**
 * The adapter's table for a collection slug. `tableNameMap` is keyed by Payload's
 * snake-cased slug; match on letters and digits only, so the key's exact casing rules
 * don't matter. Undefined when no single table matches.
 */
const tableFor = (map: Map<string, string>, slug: string): string | undefined => {
  const direct = map.get(slug.replace(/-/g, '_'))
  if (direct) return direct
  const wanted = squash(slug)
  const matches = [...map.entries()].filter(([key]) => squash(key) === wanted)
  return matches.length === 1 ? matches[0][1] : undefined
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

type ClaimArgs = {
  payload: Payload
  slug: string
  id: string
  from: string
  to: string
  fields: DeliveryClaimFields
  now: Date
}

const warned = new WeakSet<object>()
const warnOnce = (payload: Payload, message: string) => {
  const key = (payload.db as object | undefined) ?? payload
  if (warned.has(key)) return
  warned.add(key)
  payload.logger?.warn?.(`payload-notifications: ${message}`)
}

/**
 * One `UPDATE … SET status = to, … WHERE id = ? AND status = from RETURNING id` on a SQL
 * adapter (Postgres, SQLite, D1). `undefined` when the statement can't be built here
 * (unknown adapter, table, ID or value); a statement that ran always gives an answer.
 */
const claimWithSql = async ({
  payload,
  slug,
  id,
  from,
  to,
  fields,
  now,
}: ClaimArgs): Promise<boolean | undefined> => {
  const db = payload.db as unknown as DrizzleLikeAdapter | undefined
  if (typeof db?.execute !== 'function' || !db.drizzle || !db.tableNameMap) return undefined
  const table = tableFor(db.tableNameMap, slug)
  const idLiteral = sqlId(id)
  if (!table || !idLiteral) return undefined
  const sets = [`"status" = ${quoteText(to)}`, `"updated_at" = ${quoteText(now.toISOString())}`]
  for (const [field, value] of Object.entries(fields) as Array<
    [keyof DeliveryClaimFields, string | number | null | undefined]
  >) {
    if (value === undefined) continue
    const literal = sqlValue(value)
    if (literal === undefined) return undefined
    sets.push(`${quoteIdent(COLUMNS[field])} = ${literal}`)
  }
  const target = db.schemaName
    ? `${quoteIdent(db.schemaName)}.${quoteIdent(table)}`
    : quoteIdent(table)
  const raw =
    `UPDATE ${target} SET ${sets.join(', ')} ` +
    `WHERE "id" = ${idLiteral} AND "status" = ${quoteText(from)} RETURNING "id"`
  const changed = changedRows(await db.execute({ drizzle: db.drizzle, raw }))
  if (changed !== undefined) return changed > 0
  // The UPDATE ran but this driver's result doesn't say whether it matched. Never fall
  // back to a second conditional update (the row may already have moved): read it back.
  warnOnce(
    payload,
    'cannot read the row count of this database driver; delivery claims fall back to a read-back check',
  )
  const row = (await payload.findByID({
    collection: slug as never,
    id,
    depth: 0,
    overrideAccess: true,
    disableErrors: true,
  })) as { status?: string; updatedAt?: string } | null
  return row?.status === to && row.updatedAt === now.toISOString()
}

/** `findOneAndUpdate({ _id, status: from })` on the Mongoose adapter, or undefined. */
const claimWithMongo = async ({
  payload,
  slug,
  id,
  from,
  to,
  fields,
  now,
}: ClaimArgs): Promise<boolean | undefined> => {
  const model = (payload.db as unknown as { collections?: Record<string, MongooseModelLike> })
    ?.collections?.[slug]
  if (typeof model?.findOneAndUpdate !== 'function') return undefined
  const set = Object.fromEntries(
    Object.entries({ ...fields, status: to, updatedAt: now }).filter(([, v]) => v !== undefined),
  )
  const previous = await model.findOneAndUpdate({ _id: id, status: from }, { $set: set })
  return Boolean(previous)
}

/**
 * Compare-and-set on a delivery's status: moves it from `from` to `to` (with `fields` and
 * a fresh `updatedAt`) only if it is still `from`, in one database operation, and returns
 * whether this caller won. Two send jobs for one delivery (a reconcile re-queue next to
 * the original job, say) then can't both act on it: the loser sees `false` and stops.
 *
 * SQL adapters run one conditional `UPDATE … RETURNING`; MongoDB uses `findOneAndUpdate`.
 * Other adapters (and the in-memory test double) use a filtered `payload.update`, which is
 * only as atomic as the adapter makes it; a warning is logged once when that happens on a
 * real database.
 */
export const claimDeliveryStatus = async ({
  payload,
  options,
  deliveryId,
  from,
  to,
  fields = {},
}: {
  payload: Payload
  options: Pick<NormalizedNotificationsPluginOptions, 'collections'>
  deliveryId: string
  from: string
  to: string
  fields?: DeliveryClaimFields
}): Promise<boolean> => {
  if (!STATUSES.has(from) || !STATUSES.has(to)) {
    throw new Error(`payload-notifications: unknown delivery status ${from} -> ${to}`)
  }
  const args: ClaimArgs = {
    payload,
    slug: options.collections.deliveries,
    id: deliveryId,
    from,
    to,
    fields,
    now: new Date(),
  }
  let attempted = false
  try {
    const viaSql = await claimWithSql(args)
    if (viaSql !== undefined) return viaSql
    const viaMongo = await claimWithMongo(args)
    if (viaMongo !== undefined) return viaMongo
  } catch (error) {
    // The statement failed, so nothing changed: the filtered update below is safe.
    attempted = true
    payload.logger?.warn?.(
      `payload-notifications: atomic status update failed, using a filtered update: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }
  if (!attempted && payload.db) {
    warnOnce(
      payload,
      `no atomic status update for collection "${args.slug}" on this adapter; concurrent send jobs for one delivery are not fully excluded`,
    )
  }
  const result = (await payload.update({
    collection: args.slug as never,
    where: {
      and: [{ id: { equals: deliveryId } }, { status: { equals: from } }],
    } as never,
    data: { ...fields, status: to } as never,
    overrideAccess: true,
  })) as { docs?: unknown[] }
  return (result.docs?.length ?? 0) > 0
}
