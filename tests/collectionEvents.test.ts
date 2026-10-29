import { describe, expect, it, mock } from 'bun:test'
import type { CollectionConfig } from 'payload'
import { normalizePluginOptions } from '../src/config/normalizePluginOptions'
import {
  buildCollectionEvent,
  normalizeCollectionEvents,
  validateCollectionEvents,
} from '../src/events/collectionEvents'
import { notificationsPlugin } from '../src/plugin'
import type { NotificationsPluginOptions } from '../src/types'
import { createMemoryPayload } from './helpers/memoryPayload'

type Doc = Record<string, unknown>
type Hook = (args: Doc) => Promise<unknown>

const existingHook = mock(async ({ doc }: Doc) => doc)

const collections: CollectionConfig[] = [
  { slug: 'users', auth: true, fields: [{ name: 'name', type: 'text' }] },
  {
    slug: 'orders',
    hooks: { afterChange: [existingHook as never] },
    fields: [
      { name: 'status', type: 'text' },
      { name: 'total', type: 'number' },
      { name: 'customer', type: 'relationship', relationTo: 'users' },
      { name: 'notes', type: 'textarea' },
      { name: 'paymentToken', type: 'text' },
    ],
  },
  { slug: 'products', fields: [{ name: 'title', type: 'text' }] },
]

const orderEvents = { orders: { capture: ['status', 'total'], userField: 'customer' } }

const pluginOptions: NotificationsPluginOptions = {
  channels: ['email', 'inapp'],
  collectionEvents: orderEvents,
  templates: {
    registry: {
      'order.paid': {
        email: { subject: 'Order {{ order.id }} paid', body: 'Total {{ order.total }}' },
      },
    },
  },
  triggers: [
    {
      slug: 'order-status-paid',
      source: { type: 'collection', collection: 'orders', operation: 'update' },
      conditions: { field: 'doc.status', operator: 'changedTo', value: 'paid' },
      data: { sources: [{ type: 'document', alias: 'order', fields: ['status', 'total'] }] },
      deliveries: [{ channel: 'email', template: 'order.paid' }],
    },
  ],
}

describe('collectionEvents options', () => {
  it('normalizes defaults and rejects bad shapes', () => {
    expect(normalizeCollectionEvents(orderEvents)).toEqual({
      orders: {
        operations: ['create', 'update'],
        capture: ['status', 'total'],
        onlyWhenCaptureChanges: true,
        label: undefined,
        userField: 'customer',
      },
    })
    expect(() => normalizeCollectionEvents({ orders: { capture: 'status' as never } })).toThrow(
      'collectionEvents["orders"].capture must be an array',
    )
    expect(() =>
      normalizeCollectionEvents({
        orders: { capture: ['status'], operations: ['upsert' as never] },
      }),
    ).toThrow('operations must list create, update and/or delete')
  })

  it('validates collections and fields against the Payload config', () => {
    const options = normalizePluginOptions({
      collectionEvents: {
        orders: { capture: ['status', 'missing', 'paymentToken'], userField: 'buyer' },
        ghosts: { capture: ['x'] },
        'notification-logs': { capture: ['status'] },
      },
    })
    expect(validateCollectionEvents(collections, options)).toEqual([
      'collectionEvents["orders"]: field "missing" does not exist on the collection',
      'collectionEvents["orders"]: field "paymentToken" is sensitive and cannot be captured',
      'collectionEvents["orders"]: userField "buyer" does not exist on the collection',
      'collectionEvents["ghosts"]: collection does not exist in the Payload config',
      'collectionEvents["notification-logs"]: notification collections cannot emit collection events',
    ])
  })
})

describe('buildCollectionEvent', () => {
  const config = normalizeCollectionEvents(orderEvents).orders
  const before = { id: 'o1', status: 'pending', total: 10, notes: 'a', customer: { id: 'u1' } }

  it('captures only configured fields and derives userId', () => {
    expect(
      buildCollectionEvent({
        collection: 'orders',
        config,
        operation: 'update',
        doc: { ...before, status: 'paid', notes: 'b' },
        previousDoc: before,
      }),
    ).toEqual({
      name: 'collection.orders.update',
      source: { type: 'collection', collection: 'orders', operation: 'update' },
      userId: 'u1',
      payload: { id: 'o1', collection: 'orders', operation: 'update' },
      doc: { id: 'o1', status: 'paid', total: 10 },
      previous: { id: 'o1', status: 'pending', total: 10 },
    })
  })

  it('emits nothing when only uncaptured fields change', () => {
    expect(
      buildCollectionEvent({
        collection: 'orders',
        config,
        operation: 'update',
        doc: { ...before, notes: 'changed' },
        previousDoc: before,
      }),
    ).toBeUndefined()
    expect(
      buildCollectionEvent({
        collection: 'orders',
        config: { ...config, onlyWhenCaptureChanges: false },
        operation: 'update',
        doc: { ...before, notes: 'changed' },
        previousDoc: before,
      }),
    ).toBeDefined()
  })

  it('captures the deleted document for delete events', () => {
    const event = buildCollectionEvent({
      collection: 'orders',
      config,
      operation: 'delete',
      doc: before,
    })
    expect(event?.doc).toEqual({ id: 'o1', status: 'pending', total: 10 })
    expect(event?.previous).toBeNull()
  })
})

describe('collection event triggers', () => {
  it('rejects triggers on unconfigured collections, operations and uncaptured fields', () => {
    expect(() =>
      normalizePluginOptions({
        collectionEvents: orderEvents,
        triggers: [
          {
            slug: 'a',
            source: { type: 'collection', collection: 'products', operation: 'create' },
            deliveries: [{ channel: 'email', template: 't' }],
          },
          {
            slug: 'b',
            source: { type: 'collection', collection: 'orders', operation: 'delete' },
            data: { sources: [{ type: 'document', alias: 'order', fields: ['notes'] }] },
            deliveries: [{ channel: 'email', template: 't' }],
          },
          {
            slug: 'c',
            event: 'order.paid',
            data: { sources: [{ type: 'document', alias: 'order' }] },
            deliveries: [{ channel: 'email', template: 't' }],
          },
        ],
      }),
    ).toThrow(
      [
        'trigger "a": collection "products" is not configured in collectionEvents',
        'trigger "b": collectionEvents["orders"] does not emit delete events',
        'trigger "b" source "order": field "notes" is not captured for "orders"',
        'trigger "c": document sources need a collection event source',
      ].join('\n  - '),
    )
  })
})

describe('collection hooks end to end', () => {
  const boot = () => {
    const config = notificationsPlugin(pluginOptions)({ collections } as never)
    const memory = createMemoryPayload({
      users: [{ id: 'u1', name: 'Alex', email: 'alex@example.com' }],
    })
    ;(memory.payload as unknown as { config: unknown }).config = config
    const orders = config.collections!.find((collection) => collection.slug === 'orders')!
    const [existing, afterChange] = orders.hooks!.afterChange as unknown as Hook[]
    const [afterDelete] = orders.hooks!.afterDelete as unknown as Hook[]
    return { config, memory, existing, afterChange, afterDelete }
  }

  const req = (memory: ReturnType<typeof createMemoryPayload>, context: Doc = {}) => ({
    payload: memory.payload,
    context,
    transactionID: 'tx-1',
  })

  it('adds hooks only to configured collections and keeps existing hooks', () => {
    const { config, existing, afterDelete } = boot()
    expect(existing).toBe(existingHook)
    expect(afterDelete).toBeFunction()
    const products = config.collections!.find((collection) => collection.slug === 'products')!
    expect(products.hooks).toBeUndefined()
  })

  it('does not fire a changedTo paid trigger when only notes change', async () => {
    const { memory, afterChange } = boot()
    const previousDoc = { id: 'o1', status: 'paid', total: 50, notes: 'a', customer: 'u1' }
    await afterChange({
      doc: { ...previousDoc, notes: 'gift wrap' },
      previousDoc,
      operation: 'update',
      req: req(memory),
    })
    expect(memory.queue).toHaveBeenCalledTimes(0)
  })

  it('queues the event inside the transaction and notifies when status changes to paid', async () => {
    const { config, memory, afterChange } = boot()
    const previousDoc = { id: 'o1', status: 'pending', total: 50, customer: 'u1' }
    const hookReq = req(memory)
    await afterChange({
      doc: { ...previousDoc, status: 'paid' },
      previousDoc,
      operation: 'update',
      req: hookReq,
    })

    expect(memory.queue).toHaveBeenCalledTimes(1)
    const job = (memory.queue.mock.calls[0] as unknown as [Doc])[0]
    expect(job.req).toBe(hookReq)
    expect(job.task).toBe('notification:process-event')

    const tasks = (config.jobs as { tasks: Array<{ slug: string; handler: Hook }> }).tasks
    await tasks
      .find((task) => task.slug === 'notification:process-event')!
      .handler({ input: job.input, job: { id: 'j1' }, req: { payload: memory.payload } })

    const [delivery] = memory.docs('notification-deliveries')
    expect(delivery).toMatchObject({
      event: 'collection.orders.update',
      trigger: 'order-status-paid',
      recipientId: 'u1',
      channel: 'email',
    })
    expect((delivery.context as Doc).order).toEqual({ id: 'o1', status: 'paid', total: 50 })
  })

  it('honours req.context.skipNotifications and hook context', async () => {
    const { memory, afterChange } = boot()
    const previousDoc = { id: 'o1', status: 'pending', total: 50 }
    await afterChange({
      doc: { ...previousDoc, status: 'paid' },
      previousDoc,
      operation: 'update',
      req: req(memory, { skipNotifications: true }),
    })
    await afterChange({
      doc: { ...previousDoc, status: 'paid' },
      previousDoc,
      operation: 'update',
      req: req(memory),
      context: { skipNotifications: true },
    })
    expect(memory.queue).toHaveBeenCalledTimes(0)
  })

  it('ignores operations that are not configured', async () => {
    const { memory, afterDelete } = boot()
    await afterDelete({ doc: { id: 'o1', status: 'paid' }, req: req(memory) })
    expect(memory.queue).toHaveBeenCalledTimes(0)
  })
})
