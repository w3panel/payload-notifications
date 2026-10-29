import { describe, expect, it, mock } from 'bun:test'
import { normalizePluginOptions } from '../src/config/normalizePluginOptions'
import { buildDataContext } from '../src/data/buildContext'
import { listDataFunctions, ResolverError, runDataResolver } from '../src/data/resolvers'
import { createDataSourcesListHandler } from '../src/endpoints/dataSources'
import type {
  NotificationDataContext,
  NotificationDataSource,
  NotificationEvent,
  StandardSchemaV1Like,
} from '../src/types'

const event: NotificationEvent = {
  name: 'order.paid',
  eventId: 'evt_1',
  userId: 'user_1',
  payload: { orderId: 'ORD-1042' },
}

const context = {
  event: 'order.paid',
  userId: 'user_1',
  payload: {},
  trigger: { name: 'order.paid' },
} as NotificationDataContext

const storeOutput: StandardSchemaV1Like = {
  '~standard': {
    version: 1,
    vendor: 'test',
    validate: (value) =>
      value && typeof (value as Record<string, unknown>).name === 'string'
        ? { value }
        : { issues: [{ message: 'Expected string', path: ['name'] }] },
  },
}

const createPayload = () => {
  const warn = mock(() => undefined)
  const db: Record<string, Record<string, unknown>[]> = {
    orders: [{ id: 'ORD-1042', total: 2499, customer: 'user_1', store: 'store_1' }],
    users: [{ id: 'user_1', name: 'Alex', email: 'alex@example.com' }],
    stores: [{ id: 'store_1', name: 'TechNewWings Store', supportEmail: 'support@example.com' }],
  }
  const findByID = mock(
    async ({ collection, id }: { collection: string; id: string }) =>
      db[collection]?.find((doc) => doc.id === id) ?? null,
  )
  return { payload: { findByID, logger: { warn } } as never, warn, findByID }
}

const orderPaidSources: NotificationDataSource[] = [
  {
    type: 'collection',
    alias: 'order',
    collection: 'orders',
    lookup: { type: 'id', from: 'event.payload.orderId' },
    fields: ['total', 'customer', 'store'],
  },
  {
    type: 'collection',
    alias: 'customer',
    collection: 'users',
    lookup: { type: 'relationship', from: 'order.customer' },
    fields: ['name', 'email'],
  },
  { type: 'resolver', alias: 'store', name: 'storeDetails', required: false },
  { type: 'computed', alias: 'totals', name: 'formattedTotal' },
]

describe('resolver registry options', () => {
  it('normalizes bare functions and definitions', () => {
    const handler = () => ({})
    const options = normalizePluginOptions({
      dataResolvers: { a: handler, b: { handler, label: 'B', timeoutMs: 100 } },
      computed: { c: handler },
    })
    expect(options.dataResolvers.a.handler).toBe(handler)
    expect(options.dataResolvers.b.label).toBe('B')
    expect(options.computed.c.handler).toBe(handler)
  })

  it('rejects invalid resolver definitions', () => {
    expect(() => normalizePluginOptions({ dataResolvers: { a: {} as never } })).toThrow(
      'dataResolvers["a"] must be a function or { handler }',
    )
    expect(() =>
      normalizePluginOptions({ dataResolvers: { a: { handler: () => 1, timeoutMs: 0 } } }),
    ).toThrow('timeoutMs must be an integer')
    expect(() =>
      normalizePluginOptions({ dataResolvers: { a: { handler: () => 1, output: 'x' as never } } }),
    ).toThrow('output must be a Standard Schema')
    expect(() => normalizePluginOptions({ computed: { c: 1 as never } })).toThrow('computed["c"]')
  })
})

describe('runDataResolver', () => {
  const { payload } = createPayload()

  it('passes context, event, validated input and an abort signal', async () => {
    const handler = mock(async (args: { input: Record<string, unknown>; signal: AbortSignal }) => ({
      got: args.input,
      aborted: args.signal.aborted,
    }))
    const value = await runDataResolver({
      name: 'r',
      definition: { handler, input: (input) => ({ ...input, normalized: true }) },
      payload,
      event,
      context,
      input: { id: 1 },
    })
    expect(value).toEqual({ got: { id: 1, normalized: true }, aborted: false })
  })

  it('times out with a typed error and aborts the signal', async () => {
    let signal: AbortSignal | undefined
    const error = await runDataResolver({
      name: 'slow',
      definition: {
        timeoutMs: 10,
        handler: (args) => {
          signal = args.signal
          return new Promise(() => undefined)
        },
      },
      payload,
      event,
      context,
    }).catch((caught) => caught)

    expect(error).toBeInstanceOf(ResolverError)
    expect(error.kind).toBe('timeout')
    expect(error.resolver).toBe('slow')
    expect(error.message).toBe('payload-notifications: resolver "slow" timed out after 10 ms')
    expect(signal?.aborted).toBe(true)
  })

  it('rejects invalid output and input', async () => {
    const output = await runDataResolver({
      name: 'store',
      definition: { handler: () => ({ name: 42 }), output: storeOutput },
      payload,
      event,
      context,
    }).catch((caught) => caught)
    expect(output.kind).toBe('invalid-output')
    expect(output.message).toContain('returned invalid output: name: Expected string')

    const input = await runDataResolver({
      name: 'store',
      definition: {
        handler: () => ({}),
        input: () => {
          throw new Error('storeId required')
        },
      },
      payload,
      event,
      context,
    }).catch((caught) => caught)
    expect(input.kind).toBe('invalid-input')
  })

  it('wraps thrown errors with the resolver name', async () => {
    const error = await runDataResolver({
      name: 'crm',
      definition: {
        handler: () => {
          throw new Error('503')
        },
      },
      payload,
      event,
      context,
    }).catch((caught) => caught)
    expect(error.kind).toBe('error')
    expect(error.message).toBe('payload-notifications: resolver "crm" failed: 503')
    expect(error.cause).toBeInstanceOf(Error)
  })
})

describe('buildDataContext with resolvers', () => {
  const options = normalizePluginOptions({
    dataResolvers: {
      storeDetails: {
        output: storeOutput,
        handler: async ({ payload, context }) => {
          const order = context.order as { store: string }
          const store = (await payload.findByID({
            collection: 'stores' as never,
            id: order.store,
          })) as Record<string, unknown>
          return { name: store.name, supportEmail: store.supportEmail }
        },
      },
    },
    computed: {
      formattedTotal: (ctx) => ({ total: `₹${(ctx.order as { total: number }).total}` }),
    },
  })

  it('resolves order → customer → store → computed', async () => {
    const { payload } = createPayload()
    const result = await buildDataContext({
      payload,
      event,
      sources: orderPaidSources,
      dataResolvers: options.dataResolvers,
      computed: options.computed,
    })
    if (!result.ok) throw new Error(result.message)
    expect(result.context.customer).toEqual({
      id: 'user_1',
      name: 'Alex',
      email: 'alex@example.com',
    })
    expect(result.context.store).toEqual({
      name: 'TechNewWings Store',
      supportEmail: 'support@example.com',
    })
    expect(result.context.totals).toEqual({ total: '₹2499' })
  })

  it('logs and nulls an optional resolver failure', async () => {
    const { payload, warn } = createPayload()
    const result = await buildDataContext({
      payload,
      event,
      sources: [{ type: 'resolver', alias: 'store', name: 'broken', required: false }],
      dataResolvers: { broken: { handler: () => ({ name: 1 }), output: storeOutput } },
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.context.store).toBeNull()
      expect(result.missing).toEqual(['store'])
    }
    expect(warn).toHaveBeenCalledTimes(1)
    const [meta, message] = warn.mock.calls[0] as unknown as [Record<string, unknown>, string]
    expect(meta).toMatchObject({ resolver: 'broken', kind: 'invalid-output', source: 'store' })
    expect(message).toContain('resolver "broken" returned invalid output')
  })

  it('stops with resolver-failed when a required resolver fails', async () => {
    const { payload } = createPayload()
    const result = await buildDataContext({
      payload,
      event,
      sources: [{ type: 'resolver', alias: 'points', name: 'loyalty' }],
      dataResolvers: { loyalty: { timeoutMs: 5, handler: () => new Promise(() => undefined) } },
    })
    expect(result).toEqual({
      ok: false,
      reason: 'resolver-failed',
      source: 'points',
      message: 'payload-notifications: resolver "loyalty" timed out after 5 ms',
    })
  })

  it('treats unregistered resolvers as failures', async () => {
    const { payload } = createPayload()
    const result = await buildDataContext({
      payload,
      event,
      sources: [{ type: 'resolver', alias: 'x', name: 'ghost' }],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('not registered in dataResolvers')
  })
})

describe('data function listing', () => {
  const options = normalizePluginOptions({
    data: { collections: { users: { fields: ['name'], label: 'Users' } } },
    dataResolvers: {
      storeDetails: {
        label: 'Store details',
        fields: ['name', 'supportEmail'],
        handler: () => ({}),
      },
    },
    computed: { formattedTotal: () => ({}) },
  })

  it('describes resolvers and computed functions without code', () => {
    expect(listDataFunctions(options)).toEqual({
      resolvers: [
        {
          name: 'storeDetails',
          label: 'Store details',
          description: undefined,
          fields: ['name', 'supportEmail'],
        },
      ],
      computed: [
        { name: 'formattedTotal', label: 'formattedTotal', description: undefined, fields: [] },
      ],
    })
  })

  it('data-sources endpoint requires a user and lists everything', async () => {
    const handler = createDataSourcesListHandler(() => options)
    expect((await handler({ user: null } as never)).status).toBe(401)
    const body = await (await handler({ user: { id: 'a' } } as never)).json()
    expect(body.collections).toEqual([{ slug: 'users', label: 'Users', fields: ['name'] }])
    expect(body.resolvers[0].name).toBe('storeDetails')
    expect(body.computed[0].name).toBe('formattedTotal')
  })
})
