import { describe, expect, it } from 'bun:test'
import { normalizePluginOptions } from '../src/config/normalizePluginOptions'
import { processEvent } from '../src/jobs/processEvent'
import { buildDeliveryFingerprint } from '../src/reliability'
import { collectTriggerWarnings, findOverlappingTriggers } from '../src/triggers/validate'
import type { NotificationsPluginOptions, NotificationTrigger } from '../src/types'
import { createMemoryPayload } from './helpers/memoryPayload'

type Doc = Record<string, unknown>

describe('legacy fingerprints', () => {
  it('fall back to the event id when no idempotency key is given', () => {
    const base = { userId: 'u1', channel: 'email' as const, template: 't', event: 'e' }
    expect(buildDeliveryFingerprint({ ...base, idempotencyKey: 'k' })).toBe('u1::email::e::t::k')
    expect(buildDeliveryFingerprint({ ...base, idempotencyKey: 'k', eventId: 'evt_1' })).toBe(
      'u1::email::e::t::k',
    )
    expect(buildDeliveryFingerprint({ ...base, eventId: 'evt_1' })).toBe(
      'u1::email::e::t::event:evt_1',
    )
    expect(buildDeliveryFingerprint(base)).toBe('u1::email::e::t::no-idempotency-key')
  })
})

const pluginOptions: NotificationsPluginOptions = {
  channels: ['email'],
  collectionEvents: { orders: { capture: ['status'], userField: 'customer' } },
  data: { collections: { orders: { fields: ['status', 'customer'] } } },
  triggers: [
    {
      slug: 'paid-event',
      event: 'order.paid',
      dedupe: { key: 'order.paid:{{ event.payload.orderId }}' },
      deliveries: [{ channel: 'email', template: 'order.paid' }],
    },
    {
      slug: 'paid-hook',
      source: { type: 'collection', collection: 'orders', operation: 'update' },
      conditions: { field: 'doc.status', operator: 'changedTo', value: 'paid' },
      dedupe: { key: 'order.paid:{{ doc.id }}', windowSeconds: 3600 },
      deliveries: [{ channel: 'email', template: 'order.paid' }],
    },
  ],
}

describe('cross-source dedupe', () => {
  const users = [{ id: 'u1', email: 'u1@example.com' }]

  it('skips the collection-hook delivery when the explicit event already notified', async () => {
    const memory = createMemoryPayload({ users })
    const options = normalizePluginOptions(pluginOptions)

    await processEvent({
      payload: memory.payload,
      event: { name: 'order.paid', eventId: 'evt_a', userId: 'u1', payload: { orderId: 'o1' } },
      options,
    })
    const result = await processEvent({
      payload: memory.payload,
      event: {
        name: 'collection.orders.update',
        eventId: 'evt_b',
        userId: 'u1',
        source: { type: 'collection', collection: 'orders', operation: 'update' },
        doc: { id: 'o1', status: 'paid' },
        previous: { id: 'o1', status: 'pending' },
      },
      options,
    })

    const deliveries = memory.docs('notification-deliveries')
    expect(deliveries.map((d) => [d.trigger, d.status, d.dedupeKey])).toEqual([
      ['paid-event', 'queued', 'order.paid:o1'],
      ['paid-hook', 'skipped', 'order.paid:o1'],
    ])
    expect(deliveries[1].skipReason).toBe(`Duplicate of delivery ${deliveries[0].id} (dedupe key)`)
    expect(result.deliveries[0].status).toBe('duplicate')
    expect(memory.queue).toHaveBeenCalledTimes(1)
  })

  it('does not count failed deliveries or other orders', async () => {
    const memory = createMemoryPayload({ users })
    const options = normalizePluginOptions(pluginOptions)
    await processEvent({
      payload: memory.payload,
      event: { name: 'order.paid', eventId: 'e1', userId: 'u1', payload: { orderId: 'o1' } },
      options,
    })
    memory.docs('notification-deliveries')[0].status = 'failed'
    await processEvent({
      payload: memory.payload,
      event: { name: 'order.paid', eventId: 'e2', userId: 'u1', payload: { orderId: 'o1' } },
      options,
    })
    await processEvent({
      payload: memory.payload,
      event: { name: 'order.paid', eventId: 'e3', userId: 'u1', payload: { orderId: 'o2' } },
      options,
    })
    expect(memory.docs('notification-deliveries').map((d) => d.status)).toEqual([
      'failed',
      'queued',
      'queued',
    ])
  })

  it('respects the dedupe window', async () => {
    const memory = createMemoryPayload({
      users,
      'notification-deliveries': [
        {
          id: 'old',
          dedupeKey: 'order.paid:o1',
          recipientKey: 'user:u1',
          channel: 'email',
          status: 'sent',
          createdAt: '2000-01-01T00:00:00.000Z',
          idempotencyKey: 'x',
        },
      ],
    })
    await processEvent({
      payload: memory.payload,
      event: {
        name: 'collection.orders.update',
        eventId: 'evt_b',
        userId: 'u1',
        source: { type: 'collection', collection: 'orders', operation: 'update' },
        doc: { id: 'o1', status: 'paid' },
        previous: { id: 'o1', status: 'pending' },
      },
      options: normalizePluginOptions(pluginOptions),
    })
    expect(memory.docs('notification-deliveries').at(-1)?.status).toBe('queued')
  })
})

describe('dedupe validation and overlap warnings', () => {
  it('validates dedupe settings', () => {
    const trigger = (dedupe: unknown) =>
      normalizePluginOptions({
        triggers: [
          {
            slug: 't',
            event: 'a.b',
            dedupe,
            deliveries: [{ channel: 'email', template: 'x' }],
          } as never,
        ],
      })
    expect(() => trigger({ key: '' })).toThrow('dedupe: key is required')
    expect(() => trigger({ key: '{{#if x}}' })).toThrow('dedupe: key is not a valid template')
    expect(() => trigger({ key: 'k', windowSeconds: 0 })).toThrow(
      'windowSeconds must be a positive integer',
    )
  })

  it('warns about overlapping triggers without dedupe keys', () => {
    const base = (slug: string, extra: Doc = {}) =>
      ({
        slug,
        source: { type: 'event', event: 'order.paid' },
        deliveries: [{ channel: 'email', template: 'x' }],
        ...extra,
      }) as NotificationTrigger
    expect(findOverlappingTriggers([base('a'), base('b')])).toEqual([
      'triggers "a" and "b" both send email to the same recipients on event order.paid; add a dedupe key if they describe the same action',
    ])
    expect(
      findOverlappingTriggers([
        base('a', { dedupe: { key: 'k' } }),
        base('b', { dedupe: { key: 'k' } }),
      ]),
    ).toEqual([])
    expect(
      findOverlappingTriggers([
        base('a'),
        base('b', { recipients: [{ type: 'static', email: 'x@y.co' }] }),
      ]),
    ).toEqual([])
    expect(
      collectTriggerWarnings(
        normalizePluginOptions({ channels: ['email'], triggers: [base('a'), base('b')] as never }),
      ),
    ).toHaveLength(1)
  })
})
