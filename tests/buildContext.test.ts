import { describe, expect, it, mock } from 'bun:test'
import { buildDataContext } from '../src/data/buildContext'
import { getPath, pickPaths, toRelationId, toSelect } from '../src/data/paths'
import type { NotificationDataSource, NotificationEvent } from '../src/types'

type Doc = Record<string, unknown>

/** In-memory Payload mock: findByID / find over fixed collections, recording calls. */
const createPayload = (db: Record<string, Doc[]>) => {
  const findByID = mock(async ({ collection, id }: { collection: string; id: string | number }) => {
    return db[collection]?.find((doc) => String(doc.id) === String(id)) ?? null
  })
  const find = mock(
    async ({ collection, where }: { collection: string; where: { id: { in: unknown[] } } }) => ({
      docs: (db[collection] ?? []).filter((doc) =>
        where.id.in.map(String).includes(String(doc.id)),
      ),
    }),
  )
  return { payload: { findByID, find } as never, findByID, find }
}

const db = {
  orders: [
    {
      id: 'ORD-1042',
      status: 'paid',
      total: 2499,
      customer: 'user_1',
      products: ['p2', { id: 'p1', title: 'populated' }],
      internalNotes: 'secret',
    },
    { id: 'ORD-2', status: 'paid', total: 5, customer: 'ghost' },
  ],
  users: [{ id: 'user_1', name: 'Alex', email: 'alex@example.com', password: 'hash' }],
  products: [
    { id: 'p1', title: 'Cable', price: 10 },
    { id: 'p2', title: 'Charger', price: 20 },
  ],
}

const event: NotificationEvent = {
  name: 'order.paid',
  eventId: 'evt_1',
  occurredAt: '2026-10-29T12:30:00.000Z',
  userId: 'user_1',
  classification: 'transactional',
  payload: { orderId: 'ORD-1042' },
}

const sources: NotificationDataSource[] = [
  {
    type: 'collection',
    alias: 'products',
    collection: 'products',
    lookup: { type: 'relationship', from: 'order.products' },
    fields: ['title'],
    required: false,
  },
  {
    type: 'collection',
    alias: 'customer',
    collection: 'users',
    lookup: { type: 'relationship', from: 'order.customer' },
    fields: ['name', 'email'],
  },
  {
    type: 'collection',
    alias: 'order',
    collection: 'orders',
    lookup: { type: 'id', from: 'event.payload.orderId' },
    fields: ['status', 'total', 'customer', 'products'],
  },
]

describe('path helpers', () => {
  it('reads, picks and selects dot paths', () => {
    expect(getPath({ a: { b: [{ c: 1 }] } }, 'a.b.0.c')).toBe(1)
    expect(pickPaths({ id: 1, a: 1, g: { b: 2, c: 3 }, x: 9 }, ['a', 'g.b'])).toEqual({
      id: 1,
      a: 1,
      g: { b: 2 },
    })
    expect(toSelect(['id', 'a', 'g.b'])).toEqual({ a: true, g: { b: true } })
  })

  it('normalizes relationship values to IDs', () => {
    expect(toRelationId('x')).toBe('x')
    expect(toRelationId(7)).toBe(7)
    expect(toRelationId({ id: 'y', title: 't' })).toBe('y')
    expect(toRelationId({ relationTo: 'users', value: { id: 'z' } })).toBe('z')
    expect(toRelationId({})).toBeUndefined()
  })
})

describe('buildDataContext', () => {
  it('resolves order → customer → products in dependency order', async () => {
    const { payload, findByID, find } = createPayload(db)
    const result = await buildDataContext({ payload, event, sources })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.context.order).toEqual({
      id: 'ORD-1042',
      status: 'paid',
      total: 2499,
      customer: 'user_1',
      products: ['p2', { id: 'p1', title: 'populated' }],
    })
    expect(result.context.customer).toEqual({
      id: 'user_1',
      name: 'Alex',
      email: 'alex@example.com',
    })
    // hasMany keeps relationship order and loads only allowlisted fields
    expect(result.context.products).toEqual([
      { id: 'p2', title: 'Charger' },
      { id: 'p1', title: 'Cable' },
    ])
    expect(result.missing).toEqual([])

    // Legacy keys remain for existing templates
    expect(result.context.event).toBe('order.paid')
    expect(result.context.userId).toBe('user_1')
    expect(result.context.payload).toEqual({ orderId: 'ORD-1042' })
    expect(result.context.trigger).toEqual({
      name: 'order.paid',
      eventId: 'evt_1',
      occurredAt: '2026-10-29T12:30:00.000Z',
      classification: 'transactional',
    })

    const orderCall = findByID.mock.calls[0][0] as Record<string, unknown>
    expect(orderCall).toMatchObject({
      collection: 'orders',
      id: 'ORD-1042',
      depth: 0,
      overrideAccess: true,
      disableErrors: true,
      select: { status: true, total: true, customer: true, products: true },
    })
    expect(find).toHaveBeenCalledTimes(1)
  })

  it('never leaks fields outside the source field list', async () => {
    const { payload } = createPayload(db)
    const result = await buildDataContext({ payload, event, sources })
    if (!result.ok) throw new Error('expected ok')
    expect(result.context.order).not.toHaveProperty('internalNotes')
    expect(result.context.customer).not.toHaveProperty('password')
  })

  it('stops with data-missing when a required source is not found', async () => {
    const { payload } = createPayload(db)
    const result = await buildDataContext({
      payload,
      event: { ...event, payload: { orderId: 'ORD-2' } },
      sources,
      owner: 'trigger "order-paid"',
    })
    expect(result).toEqual({
      ok: false,
      reason: 'data-missing',
      source: 'customer',
      message: 'trigger "order-paid": required source "customer" resolved to nothing',
    })
  })

  it('stops when the lookup key itself is absent', async () => {
    const { payload, findByID } = createPayload(db)
    const result = await buildDataContext({ payload, event: { ...event, payload: {} }, sources })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.source).toBe('order')
    expect(findByID).toHaveBeenCalledTimes(0)
  })

  it('sets optional sources to null and reports them as missing', async () => {
    const { payload } = createPayload(db)
    const result = await buildDataContext({
      payload,
      event,
      sources: [
        {
          type: 'collection',
          alias: 'manager',
          collection: 'users',
          lookup: { type: 'id', from: 'event.payload.managerId' },
          fields: ['name'],
          required: false,
        },
      ],
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.context.manager).toBeNull()
      expect(result.missing).toEqual(['manager'])
    }
  })

  it('rejects list values for id lookups', async () => {
    const { payload } = createPayload(db)
    const result = await buildDataContext({
      payload,
      event: { ...event, payload: { orderId: ['a', 'b'] } },
      sources: [sources[2]],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('use a relationship lookup')
  })

  it('exposes event and document sources', async () => {
    const { payload } = createPayload(db)
    const result = await buildDataContext({
      payload,
      event,
      doc: { id: 'ORD-1042', status: 'paid', notes: 'x' },
      previous: { id: 'ORD-1042', status: 'pending' },
      sources: [
        { type: 'event', alias: 'evt', fields: ['payload.orderId'] },
        { type: 'document', alias: 'order', fields: ['status'] },
      ],
    })
    if (!result.ok) throw new Error('expected ok')
    expect(result.context.evt).toEqual({ payload: { orderId: 'ORD-1042' } })
    expect(result.context.order).toEqual({ id: 'ORD-1042', status: 'paid' })
    expect(result.context.doc).toEqual({ id: 'ORD-1042', status: 'paid', notes: 'x' })
    expect(result.context.previous).toEqual({ id: 'ORD-1042', status: 'pending' })
  })

  it('rethrows unexpected lookup errors so the job can retry', async () => {
    const payload = {
      findByID: mock(async () => {
        throw new Error('connection reset')
      }),
    }
    await expect(
      buildDataContext({ payload: payload as never, event, sources: [sources[2]] }),
    ).rejects.toThrow('connection reset')
  })

  it('respects overrideAccess and depth options', async () => {
    const { payload, findByID } = createPayload(db)
    await buildDataContext({
      payload,
      event,
      overrideAccess: false,
      sources: [{ ...(sources[2] as never as object), depth: 1 } as NotificationDataSource],
    })
    expect(findByID.mock.calls[0][0]).toMatchObject({ overrideAccess: false, depth: 1 })
  })
})
