import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { isDuplicateKeyError } from '../../src'
import { normalizePluginOptions } from '../../src/config/normalizePluginOptions'
import { claimDeliveryStatus } from '../../src/deliveries/claim'
import { planDeliveries } from '../../src/deliveries/plan'
import { sendDelivery } from '../../src/deliveries/send'
import type {
  NotificationLifecycleContext,
  NotificationLifecycleEvent,
  NotificationsPluginOptions,
} from '../../src/types'
import { createUser, startPayload, type TestPayload } from './harness'

// Real Payload + database: slower than unit tests.
const TIMEOUT = 60_000

const lifecycle: Array<[NotificationLifecycleEvent, NotificationLifecycleContext | undefined]> = []
let vetoReason: string | undefined
/** Set by the race test: makes concurrent hook calls wait for each other. */
let raceGate: (() => Promise<{ allow: boolean; reason?: string } | undefined>) | undefined

const pluginOptions: NotificationsPluginOptions = {
  channels: ['email', 'inapp'],
  deliveries: {
    key: 'recipient',
    beforeSend: () =>
      raceGate ? raceGate() : vetoReason ? { allow: false, reason: vetoReason } : undefined,
  },
  observability: { onEvent: (event, context) => void lifecycle.push([event, context]) },
  templates: {
    registry: {
      'order.paid': { email: { subject: 'Order {{ payload.orderId }} paid', body: 'Thanks' } },
      'order.paid.staff': { email: { subject: 'New order {{ payload.orderId }}', body: 'Pack' } },
    },
  },
  triggers: [
    {
      slug: 'paid-customer',
      event: 'order.paid',
      recipients: [{ type: 'eventUser' }],
      deliveries: [{ channel: 'email', template: 'order.paid' }],
    },
    {
      slug: 'paid-mailbox',
      event: 'order.paid',
      recipients: [{ type: 'static', email: 'Owner@Shop.test', alias: 'mailbox' }],
      deliveries: [{ channel: 'email', template: 'order.paid.staff', recipient: 'mailbox' }],
    },
  ],
}

describe('send once per event, recipient and channel (real database)', () => {
  let t: TestPayload
  let ownerId: string

  beforeAll(async () => {
    t = await startPayload({ plugin: pluginOptions })
    const owner = await createUser(t.payload, { email: 'owner@shop.test', name: 'Owner' })
    ownerId = String(owner.id)
  }, TIMEOUT)

  afterAll(async () => {
    await t?.destroy()
  })

  it(
    'emails an inbox once when it is both the customer and the mailbox',
    async () => {
      const options = normalizePluginOptions(pluginOptions)
      const result = await planDeliveries({
        payload: t.payload,
        event: {
          name: 'order.paid',
          idempotencyKey: 'order:1:paid',
          userId: ownerId,
          payload: { orderId: 'EF-1' },
        },
        options,
      })
      expect(result.deliveries.map((d) => [d.trigger, d.status])).toEqual([
        ['paid-customer', 'queued'],
        ['paid-mailbox', 'existing'],
      ])
      await t.runJobs()
      expect(t.emails.map((email) => email.subject)).toEqual(['Order EF-1 paid'])
      const planned = lifecycle.find(([event]) => event.stage === 'planned')
      expect(planned?.[1]?.payload).toBe(t.payload)
      expect(planned?.[1]?.idempotencyKey).toMatch(/^order:1:paid::email::email#[0-9a-f]{32}$/)
    },
    TIMEOUT,
  )

  it(
    'creates one delivery when two plans race for the same key',
    async () => {
      const options = normalizePluginOptions(pluginOptions)
      // Hold both key lookups until both plans have made one, so both insert.
      const find = t.payload.find.bind(t.payload)
      let release!: () => void
      const bothLooked = new Promise<void>((resolve) => (release = resolve))
      let lookups = 0
      const duplicateErrors: unknown[] = []
      const create = t.payload.create.bind(t.payload)
      const payload = Object.create(t.payload) as typeof t.payload
      payload.find = (async (args: Parameters<typeof find>[0]) => {
        const where = args.where as Record<string, unknown> | undefined
        const result = await find(args)
        if (args.collection === ('notification-deliveries' as never) && where?.idempotencyKey) {
          if (++lookups === 2) release()
          if (lookups <= 2) await bothLooked
        }
        return result
      }) as typeof find
      payload.create = (async (args: Parameters<typeof create>[0]) => {
        try {
          return await create(args)
        } catch (error) {
          duplicateErrors.push(error)
          throw error
        }
      }) as typeof create

      const event = {
        name: 'order.paid',
        idempotencyKey: 'order:2:paid',
        userId: ownerId,
        payload: { orderId: 'EF-2' },
      }
      const options1 = { ...options, triggers: options.triggers.slice(0, 1) }
      const [a, b] = await Promise.all([
        planDeliveries({ payload, event, options: options1 }),
        planDeliveries({ payload, event, options: options1 }),
      ])

      const rows = await t.find('notification-deliveries', {
        idempotencyKey: { like: 'order:2:paid' },
      })
      expect(rows).toHaveLength(1)
      expect([a.deliveries[0].status, b.deliveries[0].status].sort()).toEqual([
        'existing',
        'queued',
      ])
      expect(a.deliveries[0].deliveryId).toBe(b.deliveries[0].deliveryId)
      // The database refused the second insert, and the error is recognised.
      expect(duplicateErrors).toHaveLength(1)
      expect(isDuplicateKeyError(duplicateErrors[0])).toBe(true)
    },
    TIMEOUT,
  )

  it(
    'cancels a vetoed delivery before it is sent',
    async () => {
      vetoReason = 'Held back: order already out for delivery'
      try {
        const sent = t.emails.length
        const options = normalizePluginOptions(pluginOptions)
        const result = await planDeliveries({
          payload: t.payload,
          event: {
            name: 'order.paid',
            idempotencyKey: 'order:3:paid',
            userId: ownerId,
            payload: { orderId: 'EF-3' },
          },
          options: { ...options, triggers: options.triggers.slice(0, 1) },
        })
        await t.runJobs()
        expect(t.emails.length).toBe(sent)
        const [row] = await t.find('notification-deliveries', {
          id: { equals: result.deliveries[0].deliveryId },
        })
        expect(row).toMatchObject({ status: 'cancelled', skipReason: vetoReason })
        expect(
          lifecycle.some(
            ([event]) =>
              event.stage === 'cancelled' &&
              event.deliveryId === result.deliveries[0].deliveryId &&
              event.reason === vetoReason,
          ),
        ).toBe(true)
      } finally {
        vetoReason = undefined
      }
    },
    TIMEOUT,
  )

  it(
    'claims a status atomically in the database',
    async () => {
      const created = (await t.payload.create({
        collection: 'notification-deliveries' as never,
        overrideAccess: true,
        data: {
          event: 'order.paid',
          trigger: 't',
          channel: 'email',
          status: 'queued',
          idempotencyKey: 'claim-test',
        } as never,
      })) as { id: string | number }
      const options = normalizePluginOptions(pluginOptions)
      // The SQL / Mongo path must be used, not the filtered-update fallback.
      const payload = Object.create(t.payload) as typeof t.payload
      payload.update = (() => {
        throw new Error('filtered update fallback used')
      }) as never
      payload.logger = {
        ...t.payload.logger,
        warn: (msg: unknown) => {
          throw new Error(String(msg))
        },
      } as never
      const claim = (from: string, to: string) =>
        claimDeliveryStatus({
          payload,
          options,
          deliveryId: String(created.id),
          from,
          to,
        })
      const [first, second] = await Promise.all([
        claim('queued', 'sending'),
        claim('queued', 'cancelled'),
      ])
      expect([first, second].filter(Boolean)).toHaveLength(1)
      expect(await claim('queued', 'sending')).toBe(false)
      const [row] = await t.find('notification-deliveries', { id: { equals: created.id } })
      expect(row.status).toBe(first ? 'sending' : 'cancelled')
    },
    TIMEOUT,
  )

  it(
    'lets one of two concurrent send jobs act when one vetoes',
    async () => {
      const options = normalizePluginOptions(pluginOptions)
      const result = await planDeliveries({
        payload: t.payload,
        event: {
          name: 'order.paid',
          idempotencyKey: 'order:4:paid',
          userId: ownerId,
          payload: { orderId: 'EF-4' },
        },
        options: { ...options, triggers: options.triggers.slice(0, 1) },
      })
      const deliveryId = result.deliveries[0].deliveryId as string
      let release!: () => void
      const bothChecked = new Promise<void>((resolve) => (release = resolve))
      let calls = 0
      raceGate = async () => {
        const call = ++calls
        if (call === 2) release()
        await bothChecked
        return call === 1 ? { allow: false, reason: 'Held back' } : undefined
      }
      try {
        const sent = t.emails.length
        const input = {
          deliveryId,
          userId: ownerId,
          channel: 'email' as const,
          template: 'order.paid',
          event: 'order.paid',
        }
        const results = await Promise.all([
          sendDelivery({ payload: t.payload, input, options }),
          sendDelivery({ payload: t.payload, input, options }),
        ])
        const [row] = await t.find('notification-deliveries', { id: { equals: deliveryId } })
        const statuses = results.map((r) => r.status)
        expect(statuses).toContain('skipped')
        expect(statuses.filter((s) => s !== 'skipped')).toEqual([row.status as never])
        expect(['cancelled', 'sent']).toContain(row.status as string)
        expect(t.emails.length - sent).toBe(row.status === 'sent' ? 1 : 0)
      } finally {
        raceGate = undefined
      }
    },
    TIMEOUT,
  )
})
