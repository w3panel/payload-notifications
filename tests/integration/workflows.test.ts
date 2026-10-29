import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { emitNotificationEvent, runLifecycleAction } from '../../src'
import { ProviderError } from '../../src/providers/errors'
import type { NotificationsPluginOptions } from '../../src/types'
import { createUser, startPayload, testDb, type TestPayload } from './harness'

// Real Payload + database: slower than unit tests.
const TIMEOUT = 60_000

const smsCalls: Array<{ to: string; body: string }> = []
let smsFailuresLeft = 0

const pluginOptions: NotificationsPluginOptions = {
  channels: ['email', 'sms', 'inapp'],
  eventsInbox: true,
  adminTriggers: { cacheTtlMs: 0 },
  reliability: { attempts: 3, backoff: { type: 'fixed', delayMs: 1 }, jitter: false },
  providers: {
    custom: {
      sms: {
        name: 'test-sms',
        channels: ['sms'],
        capabilities: { html: false, hsm: false, media: false },
        send: async ({ to, content }) => {
          smsCalls.push({ to, body: content.body })
          if (smsFailuresLeft > 0) {
            smsFailuresLeft--
            throw new ProviderError('Gateway busy', { kind: 'retryable', status: 503 })
          }
          return { status: 'sent', providerMessageId: `sms_${smsCalls.length}` }
        },
      },
    },
  },
  events: {
    'order.paid': { samplePayload: { orderId: 'ORD-1', total: 10 } },
    'booking.made': {},
  },
  collectionEvents: {
    orders: { capture: ['status', 'number'], userField: 'customer', operations: ['update'] },
  },
  templates: {
    registry: {
      'order.paid': {
        email: { subject: 'Order {{ payload.orderId }} paid', body: 'Thanks {{ recipient.name }}' },
        inapp: { title: 'Paid', body: 'Order {{ payload.orderId }}' },
        sms: 'Order {{ payload.orderId }} paid',
      },
      'order.shipped': {
        email: { subject: 'Order {{ doc.number }} shipped', body: 'On its way' },
      },
      'booking.reminder': { email: { subject: 'Reminder', body: 'See you soon' } },
    },
  },
  triggers: [
    {
      slug: 'order-paid',
      source: { type: 'event', event: 'order.paid' },
      recipients: [{ type: 'eventUser' }],
      deliveries: [
        { channel: 'email', template: 'order.paid' },
        { channel: 'inapp', template: 'order.paid' },
      ],
      dedupe: { key: 'paid:{{ payload.orderId }}' },
      admin: { policy: 'managed' },
    },
    {
      slug: 'order-paid-sms',
      source: { type: 'event', event: 'order.paid' },
      recipients: [{ type: 'eventUser' }],
      deliveries: [{ channel: 'sms', template: 'order.paid' }],
      admin: { policy: 'enforced' },
    },
    {
      slug: 'order-shipped',
      source: { type: 'collection', collection: 'orders', operation: 'update' },
      conditions: { all: [{ field: 'doc.status', operator: 'changedTo', value: 'shipped' }] },
      recipients: [{ type: 'eventUser' }],
      deliveries: [{ channel: 'email', template: 'order.shipped' }],
    },
    {
      slug: 'booking-reminder',
      source: { type: 'event', event: 'booking.made' },
      recipients: [{ type: 'eventUser' }],
      deliveries: [{ channel: 'email', template: 'booking.reminder' }],
      schedule: { type: 'delay', delay: '1h' },
    },
  ],
}

describe(`integration (${testDb()})`, () => {
  let t: TestPayload
  let customer: Record<string, unknown> & { id: string | number }

  beforeAll(async () => {
    t = await startPayload({
      plugin: pluginOptions,
      collections: [
        {
          slug: 'orders',
          fields: [
            { name: 'number', type: 'text' },
            { name: 'status', type: 'text' },
            { name: 'customer', type: 'relationship', relationTo: 'users' },
          ],
        },
      ],
    })
    customer = await createUser(t.payload, {
      email: 'asha@example.com',
      name: 'Asha',
      phone: '+919876543210',
    })
  }, TIMEOUT)

  afterAll(async () => {
    await t?.destroy()
  })

  const emit = (name: string, payload: Record<string, unknown>, eventId: string) =>
    emitNotificationEvent({
      payload: t.payload,
      event: { name, eventId, userId: String(customer.id), payload },
    })

  it(
    'runs order.paid from emit to email, in-app and SMS with attempt logs',
    async () => {
      t.emails.length = 0
      await emit('order.paid', { orderId: 'ORD-1' }, 'evt_paid_1')
      await t.runJobs()

      const deliveries = await t.find('notification-deliveries', {
        eventId: { equals: 'evt_paid_1' },
      })
      expect(deliveries.map((d) => `${d.trigger}:${d.channel}:${d.status}`).sort()).toEqual([
        'order-paid-sms:sms:sent',
        'order-paid:email:sent',
        'order-paid:inapp:sent',
      ])
      expect(t.emails).toEqual([
        expect.objectContaining({ to: 'asha@example.com', subject: 'Order ORD-1 paid' }),
      ])
      const inbox = await t.find('notifications', { recipient: { equals: customer.id } })
      expect(inbox[0]).toMatchObject({ title: 'Paid', message: 'Order ORD-1' })
      expect(smsCalls.at(-1)).toEqual({ to: '+919876543210', body: 'Order ORD-1 paid' })
      const logs = await t.find('notification-logs', { status: { in: ['sent', 'stored'] } })
      expect(logs.map((log) => log.channel).sort()).toEqual(['email', 'inapp', 'sms'])
      const [event] = await t.find('notification-events', { eventId: { equals: 'evt_paid_1' } })
      expect(event).toMatchObject({ status: 'processed', deliveries: 3 })
    },
    TIMEOUT,
  )

  it(
    'does not send twice for a repeated event or a duplicate dedupe key',
    async () => {
      t.emails.length = 0
      // Same eventId again: dropped by the inbox.
      await emit('order.paid', { orderId: 'ORD-1' }, 'evt_paid_1')
      // New event, same order: the email trigger's dedupe key matches.
      await emit('order.paid', { orderId: 'ORD-1' }, 'evt_paid_1b')
      await t.runJobs()
      expect(t.emails).toEqual([])
      const second = await t.find('notification-deliveries', {
        and: [{ eventId: { equals: 'evt_paid_1b' } }, { channel: { equals: 'email' } }],
      })
      expect(second[0]).toMatchObject({ status: 'skipped' })
    },
    TIMEOUT,
  )

  it(
    'retries a retryable provider failure and records each attempt',
    async () => {
      smsFailuresLeft = 1
      const before = smsCalls.length
      await emit('order.paid', { orderId: 'ORD-2' }, 'evt_paid_2')
      await t.runJobs()
      await new Promise((resolve) => setTimeout(resolve, 20))
      await t.releaseWaitingJobs()
      await t.runJobs()

      const [sms] = await t.find('notification-deliveries', {
        and: [{ eventId: { equals: 'evt_paid_2' } }, { channel: { equals: 'sms' } }],
      })
      expect(sms).toMatchObject({ status: 'sent', attempts: 2 })
      expect(smsCalls.length - before).toBe(2)
      const attempts = await t.find('notification-logs', { delivery: { equals: sms.id } })
      expect(attempts.map((log) => log.status)).toEqual(['failed', 'sent'])
    },
    TIMEOUT,
  )

  it(
    'notifies on a collection change only when the condition matches',
    async () => {
      t.emails.length = 0
      const order = await t.payload.create({
        collection: 'orders' as never,
        data: { number: 'A-100', status: 'paid', customer: customer.id } as never,
        overrideAccess: true,
      })
      await t.payload.update({
        collection: 'orders' as never,
        id: (order as { id: string | number }).id,
        data: { status: 'packed' } as never,
        overrideAccess: true,
      })
      await t.runJobs()
      expect(t.emails).toEqual([])

      await t.payload.update({
        collection: 'orders' as never,
        id: (order as { id: string | number }).id,
        data: { status: 'shipped' } as never,
        overrideAccess: true,
      })
      await t.runJobs()
      expect(t.emails).toEqual([expect.objectContaining({ subject: 'Order A-100 shipped' })])
    },
    TIMEOUT,
  )

  it(
    'holds scheduled deliveries until their time',
    async () => {
      t.emails.length = 0
      await emit('booking.made', {}, 'evt_booking_1')
      await t.runJobs()
      const [delivery] = await t.find('notification-deliveries', {
        eventId: { equals: 'evt_booking_1' },
      })
      expect(delivery).toMatchObject({ status: 'queued' })
      expect(new Date(String(delivery.scheduledFor)).getTime()).toBeGreaterThan(
        Date.now() + 50 * 60_000,
      )
      expect(t.emails).toEqual([])

      expect(await t.releaseWaitingJobs()).toBeGreaterThan(0)
      await t.runJobs()
      expect(t.emails).toEqual([expect.objectContaining({ subject: 'Reminder' })])
    },
    TIMEOUT,
  )

  it(
    'applies admin precedence: managed overrides replace, enforced cannot be overridden, standalone runs alongside',
    async () => {
      const create = (data: Record<string, unknown>) =>
        t.payload.create({
          collection: 'notification-triggers' as never,
          data: { status: 'draft', ...data } as never,
          overrideAccess: true,
        }) as Promise<{ id: string | number }>
      const publish = (id: string | number) =>
        runLifecycleAction({ payload: t.payload, options: optionsOf(t), id, action: 'publish' })

      // Managed: email only to ops instead of the customer's email + in-app.
      const managed = await create({
        name: 'Paid (ops copy)',
        slug: 'order-paid-override',
        overrides: 'order-paid',
        recipients: [{ type: 'static', email: 'ops@example.com', alias: 'ops' }],
        deliveries: [{ channel: 'email', template: 'order.paid', recipient: 'ops' }],
      })
      expect((await publish(managed.id)).status).toBe(200)

      // Enforced: an override is rejected.
      const enforced = await create({
        name: 'No SMS',
        slug: 'order-paid-sms-override',
        overrides: 'order-paid-sms',
        enabled: false,
      })
      expect((await publish(enforced.id)).status).toBe(422)

      // Standalone admin trigger on the same event.
      const standalone = await create({
        name: 'Finance',
        slug: 'finance-paid',
        source: { type: 'event', event: 'order.paid' },
        recipients: [{ type: 'static', email: 'finance@example.com', alias: 'finance' }],
        deliveries: [{ channel: 'email', template: 'order.paid', recipient: 'finance' }],
      })
      expect((await publish(standalone.id)).status).toBe(200)

      t.emails.length = 0
      await emit('order.paid', { orderId: 'ORD-3' }, 'evt_paid_3')
      await t.runJobs()
      expect(t.emails.map((email) => email.to).sort()).toEqual([
        'finance@example.com',
        'ops@example.com',
      ])
      const deliveries = await t.find('notification-deliveries', {
        eventId: { equals: 'evt_paid_3' },
      })
      expect(deliveries.map((d) => `${d.trigger}:${d.channel}:${d.triggerOrigin}`).sort()).toEqual([
        'finance-paid:email:admin',
        'order-paid-sms:sms:code',
        'order-paid:email:admin',
      ])
    },
    TIMEOUT,
  )

  it(
    'renders the active database template instead of the code registry',
    async () => {
      await t.payload.create({
        collection: 'notification-templates' as never,
        data: {
          name: 'Booking reminder',
          slug: 'booking.reminder',
          channels: ['email'],
          status: 'active',
          email: { subject: 'DB reminder for {{ recipient.name }}', textBody: 'From the database' },
        } as never,
        overrideAccess: true,
      })
      t.emails.length = 0
      await emit('booking.made', {}, 'evt_booking_2')
      await t.runJobs()
      await t.releaseWaitingJobs()
      await t.runJobs()
      expect(t.emails).toEqual([expect.objectContaining({ subject: 'DB reminder for Asha' })])
      const [delivery] = await t.find('notification-deliveries', {
        eventId: { equals: 'evt_booking_2' },
      })
      expect(delivery).toMatchObject({ templateVersion: 1 })
    },
    TIMEOUT,
  )
})

const optionsOf = (t: TestPayload) =>
  (
    t.payload.config.custom as { payloadNotifications: { getOptions: () => never } }
  ).payloadNotifications.getOptions()
