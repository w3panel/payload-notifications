import { describe, expect, it } from 'bun:test'
import { buildConfig } from 'payload'
import { isPayload4, supportsTaskConcurrency } from '../src/compat'
import { notificationsPlugin } from '../src'

// Runs against whichever Payload major is installed (CI runs both 3.x and 4.x).
const fakeDb = { name: 'fake', defaultIDType: 'text' as const, init: () => ({}) as never }

const build = (jobs?: Record<string, unknown>) =>
  buildConfig({
    secret: 'x'.repeat(32),
    db: fakeDb as never,
    ...(jobs ? { jobs: jobs as never } : {}),
    collections: [
      { slug: 'users', auth: true, fields: [{ name: 'name', type: 'text' }] },
      {
        slug: 'orders',
        fields: [
          { name: 'status', type: 'text' },
          { name: 'customer', type: 'relationship', relationTo: 'users' },
        ],
      },
    ],
    plugins: [
      notificationsPlugin({
        collectionEvents: { orders: { capture: ['status'], userField: 'customer' } },
        eventsInbox: true,
        preferences: { mode: 'collection' },
        maintenance: { reconcileCron: '*/15 * * * *' },
      }),
    ],
  })

describe('Payload compatibility', () => {
  it('builds a full config on the installed Payload major', async () => {
    const config = await build()
    const slugs = config.collections.map((collection) => collection.slug)
    expect(slugs).toEqual(
      expect.arrayContaining([
        'notifications',
        'notification-deliveries',
        'notification-template-versions',
        'notification-trigger-versions',
        'notification-events',
        'notification-preferences',
      ]),
    )
    expect((config.jobs?.tasks ?? []).map((task) => task.slug)).toEqual([
      'notification:process-event',
      'notification:send',
      'notification:reconcile',
      'notification:retention',
    ])
  })

  it('keeps send concurrency only where the host Payload allows it', async () => {
    const plain = await build()
    const send = plain.jobs?.tasks?.find((task) => task.slug === 'notification:send')
    expect(typeof send?.concurrency).toBe(isPayload4 ? 'function' : 'undefined')

    if (!isPayload4) {
      const optedIn = await build({ enableConcurrencyControl: true })
      const task = optedIn.jobs?.tasks?.find((entry) => entry.slug === 'notification:send')
      expect(typeof task?.concurrency).toBe('function')
    }
  })

  it('detects concurrency support from the host config', () => {
    expect(supportsTaskConcurrency({ jobs: { enableConcurrencyControl: true } as never })).toBe(
      true,
    )
    expect(supportsTaskConcurrency({})).toBe(isPayload4)
  })
})
