import { describe, expect, it, mock } from 'bun:test'
import { normalizePluginOptions } from '../src/config/normalizePluginOptions'
import { createTemplatePreviewHandler } from '../src/endpoints/templatePreview'
import { processEvent } from '../src/jobs/processEvent'
import { sendNotification } from '../src/jobs/sendNotification'
import { REDACTED } from '../src/data/sensitive'
import { createMemoryPayload } from './helpers/memoryPayload'
import type { NotificationDataSource } from '../src/types'

type Doc = Record<string, unknown>

const db: Record<string, Doc[]> = {
  users: [{ id: 'user_1', name: 'Alex', email: 'alex@example.com', phone: '+919876543210' }],
  orders: [{ id: 'ORD-1042', total: 2499, customer: 'user_1', status: 'paid' }],
}

const findByID = mock(async ({ collection, id }: { collection: string; id: string }) => {
  return db[collection]?.find((doc) => doc.id === id) ?? null
})

const sources: NotificationDataSource[] = [
  {
    type: 'collection',
    alias: 'order',
    collection: 'orders',
    lookup: { type: 'id', from: 'event.payload.orderId' },
    fields: ['total', 'customer'],
  },
  {
    type: 'collection',
    alias: 'customer',
    collection: 'users',
    lookup: { type: 'relationship', from: 'order.customer' },
    fields: ['name', 'email', 'phone'],
  },
  { type: 'resolver', alias: 'store', name: 'storeDetails', required: false },
]

const pluginOptions = (extra: Parameters<typeof normalizePluginOptions>[0] = {}) =>
  normalizePluginOptions({
    data: {
      collections: {
        orders: { fields: ['total', 'customer', 'status'] },
        users: { fields: ['name', 'email', 'phone'] },
      },
      redact: ['customer.phone'],
    },
    dataResolvers: { storeDetails: () => ({ name: 'TechNewWings Store' }) },
    templates: {
      registry: {
        'order.paid': {
          email: {
            subject: 'Order {{ order.id }} confirmed',
            body: 'Hi {{ customer.name }}, total {{ order.total }} at {{ store.name }} ({{ trigger.eventId }}).',
          },
          inapp: { title: 'Paid', body: '{{ customer.name }}: {{ payload.orderId }}' },
        },
      },
    },
    events: {
      'order.paid': { samplePayload: { orderId: 'ORD-1042' } },
    },
    rules: [
      {
        event: 'order.paid',
        channels: ['email', 'inapp'],
        template: 'order.paid',
        data: { sources },
      },
    ],
    ...extra,
  })

describe('rule data sources', () => {
  it('are validated when options are normalized', () => {
    expect(() =>
      normalizePluginOptions({
        rules: [
          {
            event: 'order.paid',
            channels: ['email'],
            template: 'order.paid',
            data: { sources: [sources[0]] },
          },
        ],
      }),
    ).toThrow('rules[0] ("order.paid") source "order": collection "orders" is not allowlisted')

    expect(() =>
      pluginOptions({
        dataResolvers: {},
      }),
    ).toThrow('resolver "storeDetails" is not registered in dataResolvers')
  })

  it('are resolved once at process time and captured on each delivery', async () => {
    const memory = createMemoryPayload(db)
    const result = await processEvent({
      payload: memory.payload,
      event: {
        name: 'order.paid',
        eventId: 'evt_1',
        occurredAt: '2026-10-29T00:00:00.000Z',
        userId: 'user_1',
        payload: { orderId: 'ORD-1042' },
      },
      options: pluginOptions(),
    })

    expect(result.deliveries.map((delivery) => delivery.channel)).toEqual(['email', 'inapp'])
    expect(memory.queue).toHaveBeenCalledTimes(2)
    const input = (memory.queue.mock.calls[0] as unknown as [{ input: Doc }])[0].input
    expect(input).toMatchObject({ eventId: 'evt_1', channel: 'email' })
    expect(input.deliveryId).toBeString()

    // One order lookup for both channels; the context travels on the delivery record
    const orderLookups = memory.findByID.mock.calls.filter(
      (call) => (call[0] as unknown as Doc).collection === 'orders',
    )
    expect(orderLookups).toHaveLength(1)
    const [delivery] = memory.docs('notification-deliveries')
    const context = delivery.context as Doc
    expect(context.order).toEqual({ id: 'ORD-1042', total: 2499, customer: 'user_1' })
    expect(context.store).toEqual({ name: 'TechNewWings Store' })
    expect(context.trigger).toMatchObject({ eventId: 'evt_1' })
    expect(context.recipient).toMatchObject({ id: 'user_1', name: 'Alex' })
  })
})

describe('sendNotification with data sources', () => {
  it('renders templates from resolved collection and resolver data', async () => {
    const sendEmail = mock(async () => undefined)
    const create = mock(async () => undefined)

    const result = await sendNotification({
      payload: { sendEmail, create, findByID } as never,
      input: {
        userId: 'user_1',
        channel: 'email',
        template: 'order.paid',
        event: 'order.paid',
        eventId: 'evt_1',
        eventPayload: { orderId: 'ORD-1042' },
        dataSources: sources,
      },
      options: pluginOptions(),
    })

    expect(result?.status).toBe('sent')
    const email = sendEmail.mock.calls[0][0] as unknown as { subject: string; text: string }
    expect(email.subject).toBe('Order ORD-1042 confirmed')
    expect(email.text).toBe('Hi Alex, total 2499 at TechNewWings Store (evt_1).')
  })

  it('uses the resolved context for in-app notifications', async () => {
    const create = mock(async () => undefined)
    await sendNotification({
      payload: { create, findByID } as never,
      input: {
        userId: 'user_1',
        channel: 'inapp',
        template: 'order.paid',
        event: 'order.paid',
        eventPayload: { orderId: 'ORD-1042' },
        dataSources: sources,
      },
      options: pluginOptions(),
    })
    const notification = (create.mock.calls[0] as unknown as [{ data: Doc }])[0].data
    expect(notification.message).toBe('Alex: ORD-1042')
  })

  it('skips and logs when a required source is missing', async () => {
    const sendEmail = mock(async () => undefined)
    const create = mock(async (_args: { collection: string; data: Doc }) => undefined)

    const result = await sendNotification({
      payload: { sendEmail, create, findByID } as never,
      input: {
        userId: 'user_1',
        channel: 'email',
        template: 'order.paid',
        event: 'order.paid',
        eventPayload: { orderId: 'missing' },
        dataSources: sources,
      },
      options: pluginOptions(),
    })

    expect(result?.status).toBe('skipped')
    expect(result?.reason).toContain('data-missing (order)')
    expect(sendEmail).toHaveBeenCalledTimes(0)
    const log = create.mock.calls[0][0]
    expect(log.collection).toBe('notification-logs')
    expect(log.data.status).toBe('skipped')
  })

  it('keeps legacy sends without data sources unchanged', async () => {
    const sendEmail = mock(async () => undefined)
    const create = mock(async () => undefined)
    await sendNotification({
      payload: { sendEmail, create, findByID } as never,
      input: {
        userId: 'user_1',
        channel: 'email',
        template: 'order.paid',
        event: 'order.paid',
        eventPayload: { orderId: 'ORD-1' },
      },
      options: normalizePluginOptions(),
    })
    const email = sendEmail.mock.calls[0][0] as unknown as { subject: string }
    expect(email.subject).toBe('Order ORD-1 paid')
  })
})

describe('template preview with data sources', () => {
  const request = (body: Doc, payload: Doc = { findByID }) =>
    ({ user: { id: 'admin' }, payload, json: async () => body }) as never

  const doc = {
    slug: 'order.paid',
    email: {
      subject: 'Order {{ order.id }}',
      textBody: 'Hi {{ customer.name }} — {{ store.name }}',
    },
  }

  it('resolves sources with the caller access and returns a redacted inspector', async () => {
    const lookups = mock(async (args: { collection: string; id: string }) => findByID(args))
    const handler = createTemplatePreviewHandler(() => pluginOptions())
    const res = await handler(
      request(
        { channel: 'email', doc, sampleEvent: { name: 'order.paid' }, sources },
        { findByID: lookups },
      ),
    )
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.rendered.subject).toBe('Order ORD-1042')
    expect(body.rendered.text).toBe('Hi Alex — TechNewWings Store')
    expect(body.data.context.customer.phone).toBe(REDACTED)
    expect(body.data.context.customer.name).toBe('Alex')
    expect(body.data.missing).toEqual([])

    const call = lookups.mock.calls[0][0] as unknown as Doc
    expect(call.overrideAccess).toBe(false)
    expect(call.req).toBeDefined()
  })

  it('rejects invalid sources and reports missing data', async () => {
    const handler = createTemplatePreviewHandler(() => pluginOptions())

    const invalid = await handler(
      request({ channel: 'email', doc, sources: [{ type: 'event', alias: 'trigger' }] }),
    )
    expect(invalid.status).toBe(400)
    expect((await invalid.json()).errors[0]).toContain('alias is reserved')

    const missing = await handler(
      request({
        channel: 'email',
        doc,
        sampleEvent: { name: 'order.paid', payload: { orderId: 'nope' } },
        sources,
      }),
    )
    expect(missing.status).toBe(422)
    expect((await missing.json()).source).toBe('order')
  })

  it('keeps the legacy context-only preview working', async () => {
    const handler = createTemplatePreviewHandler()
    const res = await handler(
      request({
        channel: 'email',
        doc: { email: { subject: 'Order {{ payload.orderId }}', textBody: 'x' } },
        context: { orderId: '9' },
      }),
    )
    const body = await res.json()
    expect(body.rendered.subject).toBe('Order 9')
    expect(body.data).toBeUndefined()
  })
})
