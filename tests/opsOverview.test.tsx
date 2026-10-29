import { describe, expect, it, mock } from 'bun:test'
import { renderToString } from 'react-dom/server'
import { withAdminComponents, DASHBOARD_COMPONENT } from '../src/admin-ops/adminConfig'
import { computeStats, statsEndpoint } from '../src/admin-ops/stats'
import { normalizePluginOptions } from '../src/config/normalizePluginOptions'
import { notificationsPlugin } from '../src/plugin'
import { createMemoryPayload } from './helpers/memoryPayload'

mock.module('@payloadcms/ui', () => ({
  useForm: () => ({ getData: () => ({}) }),
  useField: () => ({ value: undefined, setValue: () => {} }),
  useDocumentInfo: () => ({}),
  useFormModified: () => false,
}))
const { OverviewBody } = await import('../src/admin/NotificationsOverview')

const now = new Date('2026-10-29T12:00:00Z')
const day = (offset: number) => new Date(now.getTime() - offset * 86_400_000).toISOString()

const seed = () => ({
  'notification-deliveries': [
    {
      id: 'd1',
      status: 'sent',
      channel: 'email',
      trigger: 'paid',
      eventId: 'e1',
      createdAt: day(0),
    },
    {
      id: 'd2',
      status: 'failed',
      channel: 'sms',
      trigger: 'paid',
      eventId: 'e1',
      lastError: 'Invalid number',
      createdAt: day(1),
      updatedAt: day(1),
    },
    {
      id: 'd3',
      status: 'skipped',
      channel: 'email',
      trigger: 'shipped',
      eventId: 'e2',
      skipReason: 'opted out',
      createdAt: day(1),
    },
    {
      id: 'd4',
      status: 'delivered',
      channel: 'email',
      trigger: 'paid',
      eventId: 'e3',
      createdAt: day(20),
    },
  ],
  'notification-events': [
    { id: 'v1', eventId: 'e1', deliveries: 2, createdAt: day(0) },
    { id: 'v2', eventId: 'e2', deliveries: 1, createdAt: day(1) },
    { id: 'v3', eventId: 'e9', deliveries: 0, createdAt: day(2) },
  ],
  'notification-logs': [
    {
      id: 'l1',
      status: 'sent',
      providerResponse: { provider: 'payload-email' },
      durationMs: 100,
      createdAt: day(0),
    },
    {
      id: 'l2',
      status: 'failed',
      providerResponse: { provider: 'twilio-sms' },
      durationMs: 900,
      createdAt: day(1),
    },
    {
      id: 'l3',
      status: 'sent',
      providerResponse: { provider: 'payload-email' },
      durationMs: 300,
      createdAt: day(1),
    },
  ],
})

describe('notifications overview', () => {
  it('counts deliveries, events, skip reasons, failures and provider health', async () => {
    const memory = createMemoryPayload(seed())
    memory.payload.count = mock(async () => ({ totalDocs: 4 })) as never
    const stats = await computeStats(
      memory.payload,
      normalizePluginOptions({ eventsInbox: true }),
      { days: 7, now },
    )
    expect(stats.deliveries.total).toBe(3)
    expect(stats.deliveries.byStatus).toEqual({ sent: 1, failed: 1, skipped: 1 })
    expect(stats.deliveries.byChannel).toEqual({ email: 2, sms: 1 })
    expect(stats.deliveries.daily.map((entry) => entry.date)).toEqual(['2026-10-28', '2026-10-29'])
    expect(stats.events).toEqual({ received: 3, matched: 2, matchRate: 2 / 3, source: 'inbox' })
    expect(stats.skipReasons).toEqual([{ reason: 'opted out', count: 1 }])
    expect(stats.recentFailures).toEqual([
      expect.objectContaining({ id: 'd2', error: 'Invalid number', channel: 'sms' }),
    ])
    expect(stats.providers).toEqual([
      {
        provider: 'payload-email',
        attempts: 2,
        failures: 0,
        failureRate: 0,
        avgMs: 200,
        p95Ms: 300,
      },
      { provider: 'twilio-sms', attempts: 1, failures: 1, failureRate: 1, avgMs: 900, p95Ms: 900 },
    ])
    expect(stats.queue).toEqual({ name: 'notifications', pending: 4 })
  })

  it('falls back to events seen in deliveries without the inbox', async () => {
    const memory = createMemoryPayload(seed())
    const stats = await computeStats(memory.payload, normalizePluginOptions(), { days: 7, now })
    expect(stats.events).toEqual({ received: 2, matched: 2, matchRate: null, source: 'deliveries' })
    expect(stats.queue.pending).toBeNull()
  })

  it('requires viewDeliveries for the stats endpoint', async () => {
    const endpoint = statsEndpoint(() =>
      normalizePluginOptions({ access: { viewDeliveries: () => false } }),
    )
    expect(
      (
        await endpoint.handler({
          user: { id: 'a' },
          url: 'http://x/api/payload-notifications/stats',
        } as never)
      ).status,
    ).toBe(403)
  })

  it('adds the dashboard once, unless turned off', () => {
    const options = normalizePluginOptions()
    const admin = withAdminComponents({ routes: { admin: '/cms' } } as never, options)
    expect(admin?.components?.beforeDashboard).toEqual([
      {
        path: DASHBOARD_COMPONENT,
        clientProps: {
          apiRoute: '/api',
          adminRoute: '/cms',
          deliveriesSlug: 'notification-deliveries',
        },
      },
    ])
    expect(
      withAdminComponents({ admin } as never, options)?.components?.beforeDashboard,
    ).toHaveLength(1)
    expect(
      withAdminComponents({} as never, normalizePluginOptions({ admin: { dashboard: false } })),
    ).toBeUndefined()
    const config = notificationsPlugin()({ collections: [] })
    expect(config.admin?.components?.beforeDashboard).toHaveLength(1)
    expect(
      config.endpoints?.some((endpoint) => endpoint.path === '/payload-notifications/stats'),
    ).toBe(true)
  })

  it('renders tiles, failures with links and provider health', async () => {
    const memory = createMemoryPayload(seed())
    const stats = await computeStats(
      memory.payload,
      normalizePluginOptions({ eventsInbox: true }),
      { days: 7, now },
    )
    const html = renderToString(
      <OverviewBody
        stats={stats}
        deliveryHref={(id) => `/admin/collections/notification-deliveries/${id}`}
      />,
    ).replaceAll('<!-- -->', '')
    expect(html).toContain('Trigger match rate')
    expect(html).toContain('67%')
    expect(html).toContain('href="/admin/collections/notification-deliveries/d2"')
    expect(html).toContain('twilio-sms')
    expect(html).toContain('aria-label="Deliveries per day by status"')
  })
})
