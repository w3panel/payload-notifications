import { describe, expect, it, mock } from 'bun:test'
import type { CollectionConfig } from 'payload'
import { normalizePluginOptions } from '../src/config/normalizePluginOptions'
import { buildDataContext } from '../src/data/buildContext'
import { EVENT_DEPTH_CONTEXT_KEY, getEventDepth } from '../src/events/depth'
import { emitNotificationEvent, processEvent } from '../src/jobs/processEvent'
import { notificationsPlugin } from '../src/plugin'
import { resolveRecipients } from '../src/recipients'
import type { NotificationDataContext } from '../src/types'
import { createMemoryPayload } from './helpers/memoryPayload'

type Doc = Record<string, unknown>
type Hook = (args: Doc) => Promise<unknown>
type Task = {
  slug: string
  handler: (args: { input: Doc; job: Doc; req: Doc }) => Promise<unknown>
}

const collections: CollectionConfig[] = [
  {
    slug: 'users',
    auth: true,
    fields: [
      { name: 'roles', type: 'json' },
      { name: 'tenant', type: 'text' },
    ],
  },
  {
    slug: 'orders',
    fields: [
      { name: 'status', type: 'text' },
      { name: 'touches', type: 'number' },
      { name: 'tenant', type: 'text' },
    ],
  },
]

describe('guard options', () => {
  it('normalizes maxEventDepth and tenancy', () => {
    expect(normalizePluginOptions().maxEventDepth).toBe(3)
    expect(normalizePluginOptions().tenancy).toBeUndefined()
    expect(normalizePluginOptions({ tenancy: { field: 'tenant' } }).tenancy).toEqual({
      field: 'tenant',
      userField: 'tenant',
    })
    expect(() => normalizePluginOptions({ maxEventDepth: 0 })).toThrow('maxEventDepth')
    expect(() => normalizePluginOptions({ tenancy: { field: '' } })).toThrow('tenancy.field')
  })

  it('reads processing depth from req.context', () => {
    expect(getEventDepth(undefined)).toBe(0)
    expect(getEventDepth({ context: { [EVENT_DEPTH_CONTEXT_KEY]: 2 } } as never)).toBe(2)
  })
})

describe('event depth guard', () => {
  it('refuses to emit at maxEventDepth', async () => {
    const memory = createMemoryPayload()
    const options = normalizePluginOptions({ maxEventDepth: 2 })
    const deepReq = { context: { [EVENT_DEPTH_CONTEXT_KEY]: 2 } }
    await expect(
      emitNotificationEvent({
        payload: memory.payload,
        event: { name: 'a.b' },
        options,
        req: deepReq as never,
      }),
    ).rejects.toThrow('exceeds maxEventDepth (2)')

    const event = await emitNotificationEvent({
      payload: memory.payload,
      event: { name: 'a.b' },
      options,
      req: { context: { [EVENT_DEPTH_CONTEXT_KEY]: 1 } } as never,
    })
    expect(event.depth).toBe(1)
  })

  it('stops a workflow that writes to its own hooked collection', async () => {
    // Every processed orders.update event runs a resolver that updates the same order.
    const memory = createMemoryPayload({
      users: [{ id: 'u1', email: 'u1@example.com' }],
      orders: [{ id: 'o1', status: 'paid', touches: 0 }],
    })
    let hooks: { afterChange: Hook }
    const touchOrder = mock(async ({ req }: { req?: Doc }) => {
      const order = memory.db.orders[0]
      const previousDoc = { ...order }
      order.touches = Number(order.touches) + 1
      await hooks.afterChange({ doc: { ...order }, previousDoc, operation: 'update', req })
      return { touched: order.touches }
    })

    const config = notificationsPlugin({
      channels: ['email'],
      maxEventDepth: 3,
      collectionEvents: { orders: { capture: ['status', 'touches'] } },
      dataResolvers: { touchOrder: touchOrder as never },
      triggers: [
        {
          slug: 'self-triggering',
          source: { type: 'collection', collection: 'orders', operation: 'update' },
          recipients: [{ type: 'static', email: 'ops@example.com' }],
          data: { sources: [{ type: 'resolver', alias: 'touch', name: 'touchOrder' }] },
          deliveries: [{ channel: 'email', template: 'order.paid' }],
        },
      ],
    })({ collections } as never)
    ;(memory.payload as unknown as { config: unknown }).config = config
    const orders = config.collections!.find((collection) => collection.slug === 'orders')!
    hooks = { afterChange: (orders.hooks!.afterChange as unknown as Hook[]).at(-1)! }
    const processTask = (config.jobs as { tasks: Task[] }).tasks.find(
      (task) => task.slug === 'notification:process-event',
    )!

    // A user edit (depth 0) starts the chain.
    await hooks.afterChange({
      doc: { id: 'o1', status: 'paid', touches: 1 },
      previousDoc: { id: 'o1', status: 'paid', touches: 0 },
      operation: 'update',
      req: { payload: memory.payload, context: {} },
    })
    for (let index = 0; index < memory.queue.mock.calls.length; index++) {
      const job = (memory.queue.mock.calls[index] as unknown as [Doc])[0]
      if (job.task !== 'notification:process-event') continue
      await processTask.handler({
        input: job.input as Doc,
        job: { id: `job-${index}` },
        req: { payload: memory.payload, context: {} },
      })
    }

    const processJobs = memory.queue.mock.calls
      .map((call) => (call as unknown as [Doc])[0])
      .filter((job) => job.task === 'notification:process-event')
    expect(processJobs.map((job) => (job.input as Doc).depth ?? 0)).toEqual([0, 1, 2])
    expect(touchOrder).toHaveBeenCalledTimes(3)
    expect(memory.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('skipped collection.orders.update at depth 3'),
    )
  })
})

describe('tenancy', () => {
  const tenancy = { field: 'tenant', value: 't1' }

  it('treats documents from another tenant as missing', async () => {
    const memory = createMemoryPayload({
      orders: [
        { id: 'mine', status: 'paid', tenant: 't1' },
        { id: 'theirs', status: 'paid', tenant: 't2' },
        { id: 'shared', status: 'paid' },
      ],
    })
    const source = {
      type: 'collection' as const,
      alias: 'order',
      collection: 'orders',
      lookup: { type: 'id' as const, from: 'event.payload.orderId' },
      fields: ['status'],
    }
    const load = (orderId: string) =>
      buildDataContext({
        payload: memory.payload,
        event: { name: 'x', tenant: 't1', payload: { orderId } },
        sources: [source],
        tenancy,
      })

    const mine = await load('mine')
    expect(mine.ok && mine.context.order).toEqual({ id: 'mine', status: 'paid' })
    expect(mine.ok && mine.context.trigger.tenant).toBe('t1')
    expect(await load('theirs')).toMatchObject({
      ok: false,
      message: 'document "theirs" belongs to another tenant',
    })
    expect((await load('shared')).ok).toBe(true)
  })

  it('scopes role recipients to the event tenant', async () => {
    const memory = createMemoryPayload({
      users: [
        { id: 'a1', email: 'a1@example.com', roles: ['admin'], tenant: 't1' },
        { id: 'a2', email: 'a2@example.com', roles: ['admin'], tenant: 't2' },
      ],
    })
    const { recipients } = await resolveRecipients({
      payload: memory.payload,
      event: { name: 'x', tenant: 't1' },
      context: {} as NotificationDataContext,
      definitions: [{ type: 'role', role: 'admin' }],
      options: normalizePluginOptions({ tenancy: { field: 'tenant' } }),
    })
    expect(recipients.map((recipient) => recipient.recipientId)).toEqual(['a1'])
  })

  it('copies the tenant from the changed document into collection events', async () => {
    const memory = createMemoryPayload({ users: [{ id: 'u1', email: 'u1@example.com' }] })
    const config = notificationsPlugin({
      tenancy: { field: 'tenant' },
      collectionEvents: { orders: { capture: ['status'] } },
    })({ collections } as never)
    ;(memory.payload as unknown as { config: unknown }).config = config
    const orders = config.collections!.find((collection) => collection.slug === 'orders')!
    const afterChange = (orders.hooks!.afterChange as unknown as Hook[]).at(-1)!
    await afterChange({
      doc: { id: 'o1', status: 'paid', tenant: 't9' },
      previousDoc: { id: 'o1', status: 'pending', tenant: 't9' },
      operation: 'update',
      req: { payload: memory.payload, context: {} },
    })
    const job = (memory.queue.mock.calls[0] as unknown as [{ input: Doc }])[0]
    expect(job.input.tenant).toBe('t9')
    // Only captured fields travel on the event
    expect(job.input.doc).toEqual({ id: 'o1', status: 'paid' })
  })
})

describe('processEvent req passthrough', () => {
  it('hands the job request to resolvers', async () => {
    const memory = createMemoryPayload({ users: [{ id: 'u1', email: 'u1@example.com' }] })
    const seen: unknown[] = []
    const options = normalizePluginOptions({
      dataResolvers: {
        capture: ({ req }) => {
          seen.push(req)
          return {}
        },
      },
      triggers: [
        {
          slug: 't',
          event: 'a.b',
          data: { sources: [{ type: 'resolver', alias: 'x', name: 'capture' }] },
          deliveries: [{ channel: 'email', template: 'order.paid' }],
        },
      ],
    })
    const req = { context: {} }
    await processEvent({
      payload: memory.payload,
      event: { name: 'a.b', userId: 'u1' },
      options,
      req: req as never,
    })
    expect(seen).toEqual([req])
  })
})
