import { describe, expect, it } from 'bun:test'
import type { CollectionConfig } from 'payload'
import { normalizePluginOptions } from '../src/config/normalizePluginOptions'
import {
  assertValidDataSources,
  collectCollectionFieldPaths,
  orderDataSources,
  validateDataAllowlist,
  validateDataSources,
} from '../src/data/sources'
import { notificationsPlugin } from '../src/plugin'
import type { DataCollectionAllowlist, NotificationDataSource } from '../src/types'

const allowlist: DataCollectionAllowlist = {
  orders: { fields: ['status', 'total', 'customer', 'store', 'items'] },
  users: { fields: ['name', 'email', 'phone'] },
}

const orderPaidSources: NotificationDataSource[] = [
  {
    type: 'collection',
    alias: 'customer',
    collection: 'users',
    lookup: { type: 'relationship', from: 'order.customer' },
    fields: ['id', 'name', 'email'],
  },
  {
    type: 'collection',
    alias: 'order',
    collection: 'orders',
    lookup: { type: 'id', from: 'event.payload.orderId' },
    fields: ['id', 'status', 'total', 'customer'],
    required: true,
  },
  { type: 'resolver', alias: 'store', name: 'storeDetails' },
]

const collections: CollectionConfig[] = [
  {
    slug: 'orders',
    fields: [
      { name: 'status', type: 'text' },
      { name: 'total', type: 'number' },
      { name: 'customer', type: 'relationship', relationTo: 'users' },
      {
        type: 'tabs',
        tabs: [
          { label: 'Items', fields: [{ name: 'items', type: 'array', fields: [] }] },
          { name: 'shipping', fields: [{ name: 'address', type: 'text' }] },
        ],
      },
      { type: 'row', fields: [{ name: 'store', type: 'text' }] },
      { name: 'meta', type: 'group', fields: [{ name: 'source', type: 'text' }] },
    ],
  },
  {
    slug: 'users',
    auth: true,
    fields: [
      { name: 'name', type: 'text' },
      { name: 'phone', type: 'text' },
    ],
  },
]

describe('validateDataSources', () => {
  it('accepts the order → customer → store example', () => {
    expect(
      validateDataSources(orderPaidSources, { allowlist, resolvers: ['storeDetails'] }),
    ).toEqual([])
  })

  it('rejects non-allowlisted collections and fields', () => {
    const errors = validateDataSources(
      [
        {
          type: 'collection',
          alias: 'secret',
          collection: 'secrets',
          lookup: { type: 'id', from: 'event.payload.id' },
          fields: ['value'],
        },
        {
          type: 'collection',
          alias: 'customer',
          collection: 'users',
          lookup: { type: 'id', from: 'event.userId' },
          fields: ['password'],
        },
      ],
      { allowlist, owner: 'trigger "x"' },
    )
    expect(errors).toEqual([
      'trigger "x" source "secret": collection "secrets" is not allowlisted — add it to data.collections',
      'trigger "x" source "customer": field "password" is not allowlisted for collection "users"',
    ])
  })

  it('rejects reserved and duplicate aliases, bad depth and unknown types', () => {
    const errors = validateDataSources(
      [
        { type: 'event', alias: 'event' },
        { type: 'event', alias: 'evt' },
        { type: 'event', alias: 'evt' },
        {
          type: 'collection',
          alias: 'order',
          collection: 'orders',
          lookup: { type: 'id', from: 'event.payload.orderId' },
          fields: ['status'],
          depth: 3,
          maxItems: 500,
        },
        { type: 'sql', alias: 'raw' } as never,
        { type: 'event', alias: 'not valid' },
      ],
      { allowlist },
    )
    expect(errors).toContain('data sources source "event": alias is reserved')
    expect(errors).toContain('data sources source "evt": duplicate alias')
    expect(errors).toContain(
      'data sources source "order": depth must be an integer between 0 and 2',
    )
    expect(errors).toContain(
      'data sources source "order": maxItems must be an integer between 1 and 100',
    )
    expect(errors.some((error) => error.includes('unknown type "sql"'))).toBe(true)
    expect(errors.some((error) => error.includes('alias "not valid"'))).toBe(true)
  })

  it('checks registered resolvers and computed functions', () => {
    const errors = validateDataSources(
      [
        { type: 'resolver', alias: 'store', name: 'missing' },
        { type: 'computed', alias: 'points', name: 'nope' },
      ],
      { allowlist, resolvers: [], computed: [] },
    )
    expect(errors).toEqual([
      'data sources source "store": resolver "missing" is not registered in dataResolvers',
      'data sources source "points": computed "nope" is not registered in computed',
    ])
  })

  it('requires relationship lookups to read a loaded field', () => {
    const errors = validateDataSources(
      [
        {
          type: 'collection',
          alias: 'order',
          collection: 'orders',
          lookup: { type: 'id', from: 'event.payload.orderId' },
          fields: ['status'],
        },
        {
          type: 'collection',
          alias: 'customer',
          collection: 'users',
          lookup: { type: 'relationship', from: 'order.customer' },
          fields: ['name'],
        },
      ],
      { allowlist },
    )
    expect(errors).toEqual([
      'data sources source "customer": lookup reads "order.customer" but source "order" does not load field "customer"',
    ])
  })

  it('detects unknown aliases and cycles', () => {
    const unknown = validateDataSources(
      [
        {
          type: 'collection',
          alias: 'customer',
          collection: 'users',
          lookup: { type: 'relationship', from: 'order.customer' },
          fields: ['name'],
        },
      ],
      { allowlist },
    )
    expect(unknown[0]).toContain('reads from unknown alias "order"')

    const cycle = validateDataSources(
      [
        {
          type: 'collection',
          alias: 'a',
          collection: 'orders',
          lookup: { type: 'relationship', from: 'b.customer' },
          fields: ['customer'],
        },
        {
          type: 'collection',
          alias: 'b',
          collection: 'orders',
          lookup: { type: 'relationship', from: 'a.customer' },
          fields: ['customer'],
        },
      ],
      { allowlist },
    )
    expect(cycle[0]).toContain('circular data source dependency a → b → a')
  })

  it('assertValidDataSources throws an aggregated error', () => {
    expect(() =>
      assertValidDataSources([{ type: 'event', alias: 'trigger' }], { allowlist }),
    ).toThrow('invalid data sources\n  - data sources source "trigger": alias is reserved')
  })
})

describe('orderDataSources', () => {
  it('sorts sources so dependencies resolve first', () => {
    expect(orderDataSources(orderPaidSources).map((source) => source.alias)).toEqual([
      'order',
      'customer',
      'store',
    ])
  })
})

describe('data allowlist', () => {
  it('collects field paths through tabs, rows and groups', () => {
    const paths = collectCollectionFieldPaths(collections[0].fields)
    for (const path of [
      'status',
      'items',
      'shipping',
      'shipping.address',
      'store',
      'meta',
      'meta.source',
    ]) {
      expect(paths.has(path)).toBe(true)
    }
  })

  it('validates allowlisted collections and fields against the config', () => {
    expect(validateDataAllowlist(collections, allowlist)).toEqual([])
    expect(
      validateDataAllowlist(collections, {
        orders: { fields: ['status', 'missing'] },
        products: { fields: ['title'] },
      }),
    ).toEqual([
      'data.collections: field "missing" does not exist on collection "orders"',
      'data.collections: collection "products" does not exist in the Payload config',
    ])
  })

  it('normalizes data options with defaults', () => {
    expect(normalizePluginOptions().data).toEqual({ collections: {}, redact: [] })
    expect(() =>
      normalizePluginOptions({ data: { collections: { orders: { fields: 'status' as never } } } }),
    ).toThrow('data.collections["orders"].fields must be an array')
  })

  it('plugin fails fast on an invalid allowlist', () => {
    const plugin = notificationsPlugin({ data: { collections: { orders: { fields: ['nope'] } } } })
    expect(() => plugin({ collections } as never)).toThrow(
      'field "nope" does not exist on collection "orders"',
    )
    expect(() =>
      notificationsPlugin({ data: { collections: allowlist } })({ collections } as never),
    ).not.toThrow()
  })
})
