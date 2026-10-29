import type { Payload, TaskConfig, Where } from 'payload'
import type { NormalizedNotificationsPluginOptions } from '../types'
import { resolveProvider } from '../providers/builtin'
import { applyStatusUpdate } from '../webhooks/apply'

export const NOTIFICATION_RECONCILE_TASK = 'notification:reconcile'
export const NOTIFICATION_RETENTION_TASK = 'notification:retention'

const daysAgo = (days: number, now: Date) =>
  new Date(now.getTime() - days * 86_400_000).toISOString()

/**
 * Reconciliation: `sending` deliveries older than `reliability.staleSendingMinutes`
 * become `unknown`; `unknown` deliveries with a provider message ID are looked
 * up with the provider's `getStatus` when it has one.
 */
export const reconcileDeliveries = async (
  payload: Payload,
  options: NormalizedNotificationsPluginOptions,
  now = new Date(),
) => {
  const collection = options.collections.deliveries as never
  const cutoff = new Date(
    now.getTime() - options.reliability.staleSendingMinutes * 60_000,
  ).toISOString()
  const stale = await payload.update({
    collection,
    where: { and: [{ status: { equals: 'sending' } }, { updatedAt: { less_than: cutoff } }] },
    data: { status: 'unknown', lastError: 'Send did not finish; outcome unknown' } as never,
    overrideAccess: true,
  })

  const unknown = await payload.find({
    collection,
    where: { and: [{ status: { equals: 'unknown' } }, { providerMessageId: { exists: true } }] },
    limit: 100,
    depth: 0,
    overrideAccess: true,
    pagination: false,
  })
  let reconciled = 0
  for (const doc of unknown.docs as unknown as Array<{
    channel: string
    providerMessageId?: string
  }>) {
    const provider = resolveProvider(doc.channel as never, options)
    if (!provider?.getStatus || !doc.providerMessageId) continue
    const update = await provider.getStatus(doc.providerMessageId).catch(() => undefined)
    if (
      update &&
      (await applyStatusUpdate(payload, options, update, doc.channel as never)) === 'updated'
    ) {
      reconciled++
    }
  }
  return { staleMarkedUnknown: (stale as { docs?: unknown[] }).docs?.length ?? 0, reconciled }
}

/** Retention: deletes old attempt logs, final deliveries and processed inbox events. */
export const pruneNotifications = async (
  payload: Payload,
  options: NormalizedNotificationsPluginOptions,
  now = new Date(),
) => {
  const { logsDays, deliveriesDays, eventsDays } = options.maintenance.retention
  const removed = { logs: 0, deliveries: 0, events: 0 }
  const prune = async (collection: string, days: number | undefined, extra: Where[] = []) => {
    if (!days) return 0
    const result = await payload.delete({
      collection: collection as never,
      where: { and: [{ createdAt: { less_than: daysAgo(days, now) } }, ...extra] },
      overrideAccess: true,
    })
    return (result as { docs?: unknown[] }).docs?.length ?? 0
  }
  removed.logs = await prune(options.collections.logs, logsDays)
  removed.deliveries = await prune(options.collections.deliveries, deliveriesDays, [
    { status: { in: ['sent', 'delivered', 'failed', 'skipped', 'cancelled'] } },
  ])
  if (options.eventsInbox) {
    removed.events = await prune(options.collections.events, eventsDays, [
      { status: { equals: 'processed' } },
    ])
  }
  return removed
}

/** Task definitions for the maintenance jobs (scheduled when crons are configured). */
export const maintenanceTasks = (
  getOptions: () => NormalizedNotificationsPluginOptions,
  options: NormalizedNotificationsPluginOptions,
): TaskConfig[] => [
  {
    slug: NOTIFICATION_RECONCILE_TASK,
    label: 'Reconcile notification deliveries',
    retries: 0,
    ...(options.maintenance.reconcileCron
      ? { schedule: [{ cron: options.maintenance.reconcileCron, queue: options.jobs.queue }] }
      : {}),
    handler: async ({ req }) => ({ output: await reconcileDeliveries(req.payload, getOptions()) }),
  },
  {
    slug: NOTIFICATION_RETENTION_TASK,
    label: 'Prune old notification records',
    retries: 0,
    ...(options.maintenance.retentionCron
      ? { schedule: [{ cron: options.maintenance.retentionCron, queue: options.jobs.queue }] }
      : {}),
    handler: async ({ req }) => ({ output: await pruneNotifications(req.payload, getOptions()) }),
  },
]
