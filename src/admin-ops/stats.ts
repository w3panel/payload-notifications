import type { Endpoint, Payload, PayloadRequest, Where } from 'payload'
import type { NormalizedNotificationsPluginOptions } from '../types'
import { denyUnless, tenantWhere } from './access'

/** At most this many records are read per collection; larger windows are sampled. */
export const STATS_SCAN_LIMIT = 5000

type Doc = Record<string, unknown>

export type NotificationStats = {
  from: string
  to: string
  days: number
  sampled: boolean
  events: {
    received: number
    matched: number
    matchRate: number | null
    source: 'inbox' | 'deliveries'
  }
  deliveries: {
    total: number
    byStatus: Record<string, number>
    byChannel: Record<string, number>
    byTrigger: Array<{ trigger: string; count: number }>
    daily: Array<{ date: string; byStatus: Record<string, number> }>
  }
  skipReasons: Array<{ reason: string; count: number }>
  recentFailures: Array<{
    id: string | number
    event: string
    trigger: string
    channel: string
    status: string
    error?: string
    at?: string
  }>
  providers: Array<{
    provider: string
    attempts: number
    failures: number
    failureRate: number
    avgMs: number | null
    p95Ms: number | null
  }>
  queue: { name: string; pending: number | null }
}

const and = (...parts: Array<Where | undefined>): Where => {
  const list = parts.filter((part): part is Where => Boolean(part))
  return list.length === 1 ? list[0] : { and: list }
}

const increment = (record: Record<string, number>, key: string) => {
  record[key] = (record[key] ?? 0) + 1
}

const top = (record: Record<string, number>, limit: number, key: string) =>
  Object.entries(record)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, count]) => ({ [key]: name, count }))

const percentile = (values: number[], p: number) => {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]
}

const dayOf = (value: unknown) => (typeof value === 'string' ? value.slice(0, 10) : 'unknown')

/** Counts for the notifications overview, scoped to `tenant` when given. */
export const computeStats = async (
  payload: Payload,
  options: NormalizedNotificationsPluginOptions,
  {
    days = 7,
    now = new Date(),
    scope,
  }: {
    days?: number
    now?: Date
    scope?: { deliveries?: Where; logs?: Where; events?: Where }
  } = {},
): Promise<NotificationStats> => {
  const from = new Date(now.getTime() - days * 86_400_000)
  const inWindow: Where = { createdAt: { greater_than_equal: from.toISOString() } }
  let sampled = false
  const scan = async (collection: string, where: Where) => {
    const result = await payload.find({
      collection: collection as never,
      where,
      limit: STATS_SCAN_LIMIT,
      depth: 0,
      sort: '-createdAt',
      overrideAccess: true,
      pagination: true,
    })
    if ((result.totalDocs ?? result.docs.length) > result.docs.length) sampled = true
    return result.docs as Doc[]
  }

  const deliveries = await scan(options.collections.deliveries, and(inWindow, scope?.deliveries))
  const byStatus: Record<string, number> = {}
  const byChannel: Record<string, number> = {}
  const byTrigger: Record<string, number> = {}
  const skipReasons: Record<string, number> = {}
  const daily = new Map<string, Record<string, number>>()
  const eventIds = new Set<string>()
  for (const doc of deliveries) {
    const status = String(doc.status ?? 'unknown')
    increment(byStatus, status)
    increment(byChannel, String(doc.channel ?? 'unknown'))
    increment(byTrigger, String(doc.trigger ?? 'unknown'))
    if (status === 'skipped' || status === 'cancelled') {
      increment(skipReasons, String(doc.skipReason || doc.lastError || 'unspecified'))
    }
    const day = dayOf(doc.createdAt)
    if (!daily.has(day)) daily.set(day, {})
    increment(daily.get(day)!, status)
    if (typeof doc.eventId === 'string') eventIds.add(doc.eventId)
  }

  let events: NotificationStats['events']
  if (options.eventsInbox) {
    const received = await scan(options.collections.events, and(inWindow, scope?.events))
    const matched = received.filter((doc) => Number(doc.deliveries ?? 0) > 0).length
    events = {
      received: received.length,
      matched,
      matchRate: received.length ? matched / received.length : null,
      source: 'inbox',
    }
  } else {
    // Without the inbox only events that produced deliveries are visible.
    events = {
      received: eventIds.size,
      matched: eventIds.size,
      matchRate: null,
      source: 'deliveries',
    }
  }

  const failures = await payload.find({
    collection: options.collections.deliveries as never,
    where: and({ status: { in: ['failed', 'unknown'] } }, inWindow, scope?.deliveries),
    sort: '-updatedAt',
    limit: 10,
    depth: 0,
    overrideAccess: true,
  })

  const logs = await scan(options.collections.logs, and(inWindow, scope?.logs))
  const providers = new Map<string, { attempts: number; failures: number; durations: number[] }>()
  for (const log of logs) {
    const name = String(
      (log.providerResponse as { provider?: unknown } | undefined)?.provider ||
        log.channel ||
        'unknown',
    )
    const entry = providers.get(name) ?? { attempts: 0, failures: 0, durations: [] }
    entry.attempts++
    if (log.status === 'failed') entry.failures++
    if (typeof log.durationMs === 'number') entry.durations.push(log.durationMs)
    providers.set(name, entry)
  }

  let pending: number | null = null
  try {
    const jobs = await payload.count({
      collection: 'payload-jobs' as never,
      where: {
        and: [
          { queue: { equals: options.jobs.queue } },
          { completedAt: { exists: false } },
          { hasError: { not_equals: true } },
        ],
      },
      overrideAccess: true,
    })
    pending = jobs.totalDocs
  } catch {
    pending = null
  }

  return {
    from: from.toISOString(),
    to: now.toISOString(),
    days,
    sampled,
    events,
    deliveries: {
      total: deliveries.length,
      byStatus,
      byChannel,
      byTrigger: top(byTrigger, 10, 'trigger') as Array<{ trigger: string; count: number }>,
      daily: [...daily.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, counts]) => ({ date, byStatus: counts })),
    },
    skipReasons: top(skipReasons, 10, 'reason') as Array<{ reason: string; count: number }>,
    recentFailures: (failures.docs as Doc[]).map((doc) => ({
      id: doc.id as string | number,
      event: String(doc.event ?? ''),
      trigger: String(doc.trigger ?? ''),
      channel: String(doc.channel ?? ''),
      status: String(doc.status ?? ''),
      ...(doc.lastError ? { error: String(doc.lastError) } : {}),
      ...(doc.updatedAt ? { at: String(doc.updatedAt) } : {}),
    })),
    providers: [...providers.entries()]
      .map(([provider, entry]) => ({
        provider,
        attempts: entry.attempts,
        failures: entry.failures,
        failureRate: entry.attempts ? entry.failures / entry.attempts : 0,
        avgMs: entry.durations.length
          ? Math.round(
              entry.durations.reduce((sum, value) => sum + value, 0) / entry.durations.length,
            )
          : null,
        p95Ms: percentile(entry.durations, 95),
      }))
      .sort((a, b) => b.attempts - a.attempts),
    queue: { name: options.jobs.queue, pending },
  }
}

/** `GET /api/payload-notifications/stats?days=7` (viewDeliveries; tenant-scoped). */
export const statsEndpoint = (
  getOptions: () => NormalizedNotificationsPluginOptions,
): Endpoint => ({
  path: '/payload-notifications/stats',
  method: 'get',
  handler: async (req: PayloadRequest) => {
    const options = getOptions()
    const denied = await denyUnless(req, options.access.viewDeliveries)
    if (denied) return denied
    const url = new URL(req.url || 'http://localhost')
    const days = Math.min(90, Math.max(1, Number(url.searchParams.get('days')) || 7))
    const scope = options.tenancy
      ? {
          deliveries: tenantWhere(req, options),
          events: tenantWhere(req, options),
          logs: tenantWhere(req, options, 'delivery.tenant'),
        }
      : undefined
    return Response.json(await computeStats(req.payload, options, { days, scope }))
  },
})
