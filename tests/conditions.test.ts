import { describe, expect, it } from 'bun:test'
import { normalizePluginOptions } from '../src/config/normalizePluginOptions'
import { processEvent } from '../src/jobs/processEvent'
import {
  conditionNeedsData,
  evaluateCondition,
  previousPathFor,
  validateCondition,
  type ConditionValidationContext,
} from '../src/triggers/conditions'
import { collectTriggerWarnings } from '../src/triggers'
import type { NotificationCondition } from '../src/types'
import { createMemoryPayload } from './helpers/memoryPayload'

const scope = {
  event: {
    name: 'order.paid',
    payload: { total: 6000, tags: ['vip'], placedAt: '2026-10-01T10:00:00Z' },
  },
  payload: { total: 6000 },
  doc: { status: 'paid', customer: { id: 'u1', name: 'populated' }, note: '' },
  previous: { status: 'pending', customer: 'u1' },
  order: { status: 'paid', total: '6000' },
}

const run = (condition: NotificationCondition, extra: Record<string, unknown> = {}) =>
  evaluateCondition(condition, {
    scope: { ...scope, ...extra },
    event: { name: 'order.paid' },
    payload: {} as never,
    custom: {
      isVip: {
        handler: ({ scope: s }) =>
          (s.event as { payload: { tags: string[] } }).payload.tags.includes('vip'),
      },
    },
    documentAliases: ['order'],
  })

describe('evaluateCondition', () => {
  it('evaluates comparison operators with loose scalar and relationship equality', async () => {
    expect(await run({ field: 'doc.status', operator: 'equals', value: 'paid' })).toBe(true)
    expect(await run({ field: 'order.total', operator: 'equals', value: 6000 })).toBe(true)
    expect(await run({ field: 'doc.customer', operator: 'equals', value: 'u1' })).toBe(true)
    expect(await run({ field: 'doc.status', operator: 'notEquals', value: 'paid' })).toBe(false)
    expect(await run({ field: 'doc.status', operator: 'in', value: ['paid', 'shipped'] })).toBe(
      true,
    )
    expect(await run({ field: 'doc.status', operator: 'notIn', value: ['paid'] })).toBe(false)
    expect(await run({ field: 'event.payload.total', operator: 'greaterThan', value: 5000 })).toBe(
      true,
    )
    expect(await run({ field: 'order.total', operator: 'lessThanOrEqual', value: '6000' })).toBe(
      true,
    )
    expect(
      await run({
        field: 'event.payload.placedAt',
        operator: 'lessThan',
        value: '2026-10-02T00:00:00Z',
      }),
    ).toBe(true)
    expect(await run({ field: 'doc.missing', operator: 'greaterThan', value: 1 })).toBe(false)
  })

  it('evaluates exists and contains', async () => {
    expect(await run({ field: 'doc.status', operator: 'exists' })).toBe(true)
    expect(await run({ field: 'doc.note', operator: 'exists' })).toBe(false)
    expect(await run({ field: 'doc.note', operator: 'exists', value: false })).toBe(true)
    expect(await run({ field: 'event.payload.tags', operator: 'contains', value: 'vip' })).toBe(
      true,
    )
    expect(await run({ field: 'doc.status', operator: 'contains', value: 'ai' })).toBe(true)
  })

  it('compares doc and document aliases with previous for change operators', async () => {
    expect(previousPathFor('doc.status')).toBe('previous.status')
    expect(previousPathFor('order.status', ['order'])).toBe('previous.status')
    expect(previousPathFor('customer.name', ['order'])).toBeUndefined()

    expect(await run({ field: 'doc.status', operator: 'changed' })).toBe(true)
    expect(await run({ field: 'doc.status', operator: 'changedTo', value: 'paid' })).toBe(true)
    expect(await run({ field: 'order.status', operator: 'changedFrom', value: 'pending' })).toBe(
      true,
    )
    // populated vs ID relationship values are the same value
    expect(await run({ field: 'doc.customer', operator: 'changed' })).toBe(false)
    // unchanged status: changedTo is false even though it equals the value
    expect(
      await run(
        { field: 'doc.status', operator: 'changedTo', value: 'paid' },
        { previous: { status: 'paid' } },
      ),
    ).toBe(false)
    // create events have no previous: the value counts as changed
    expect(
      await run({ field: 'doc.status', operator: 'changedTo', value: 'paid' }, { previous: null }),
    ).toBe(true)
  })

  it('combines all / any / not and custom conditions', async () => {
    const tree: NotificationCondition = {
      all: [
        { field: 'doc.status', operator: 'equals', value: 'paid' },
        {
          any: [
            { custom: 'isVip' },
            { field: 'order.total', operator: 'greaterThan', value: 10000 },
          ],
        },
        { not: { field: 'doc.status', operator: 'equals', value: 'cancelled' } },
      ],
    }
    expect(await run(tree)).toBe(true)
    expect(await run({ custom: 'unknown' })).toBe(false)
    expect(
      await evaluateCondition(undefined, { scope, event: { name: 'x' }, payload: {} as never }),
    ).toBe(true)
  })

  it('knows when a tree needs data sources', () => {
    expect(conditionNeedsData({ field: 'doc.status', operator: 'equals', value: 'paid' })).toBe(
      false,
    )
    expect(conditionNeedsData({ all: [{ field: 'payload.total', operator: 'exists' }] })).toBe(
      false,
    )
    expect(conditionNeedsData({ field: 'order.total', operator: 'exists' })).toBe(true)
    expect(conditionNeedsData({ custom: 'isVip' })).toBe(true)
  })
})

describe('validateCondition', () => {
  const context: ConditionValidationContext = {
    owner: 'trigger "t"',
    aliases: new Map([
      ['order', ['status', 'total']],
      ['store', undefined],
    ]),
    documentAliases: new Set(),
    custom: ['isVip'],
    collectionSource: false,
    payloadFields: ['orderId', 'total'],
  }

  it('accepts valid trees', () => {
    expect(
      validateCondition(
        {
          all: [
            { field: 'event.payload.total', operator: 'greaterThan', value: 1 },
            { field: 'order.status', operator: 'in', value: ['paid'] },
            { field: 'store.anything', operator: 'exists' },
            { custom: 'isVip' },
          ],
        },
        context,
      ),
    ).toEqual({ errors: [], warnings: [] })
  })

  it('reports structural, operator, value and reference errors', () => {
    const { errors, warnings } = validateCondition(
      {
        all: [
          { field: 'order.status', operator: 'like', value: 'x' },
          { field: 'order.status', operator: 'equals' },
          { field: 'order.status', operator: 'in', value: 'paid' },
          { field: 'order.notes', operator: 'exists' },
          { field: 'customer.name', operator: 'exists' },
          { field: 'doc.status', operator: 'changedTo', value: 'paid' },
          { custom: 'nope' },
          { any: [] },
          { field: 'payload.unknown', operator: 'exists' },
        ],
      } as never,
      context,
    )
    expect(errors).toEqual([
      'trigger "t": conditions.all[0] (order.status) unknown operator "like"',
      'trigger "t": conditions.all[1] (order.status) operator equals needs a value',
      'trigger "t": conditions.all[2] (order.status) operator in needs an array value',
      'trigger "t": conditions.all[3] (order.notes) source "order" does not load field "notes"',
      'trigger "t": conditions.all[4] (customer.name) unknown root "customer" (use event, payload, doc, previous or a data source alias)',
      'trigger "t": conditions.all[5] (doc.status) change operators need a collection event source',
      'trigger "t": conditions.all[5] (doc.status) doc / previous are only available for collection event sources',
      'trigger "t": conditions.all[6] custom condition "nope" is not registered',
      'trigger "t": conditions.all[7].any must be a non-empty array',
    ])
    expect(warnings).toEqual([
      'trigger "t": conditions.all[8] (payload.unknown) payload path "unknown" is not in the event\'s samplePayload',
    ])
  })

  it('checks captured fields for collection sources', () => {
    const { errors } = validateCondition(
      {
        all: [
          { field: 'doc.status', operator: 'changedTo', value: 'paid' },
          { field: 'doc.notes', operator: 'changed' },
        ],
      },
      { ...context, collectionSource: true, capturedFields: ['status'] },
    )
    expect(errors).toEqual([
      'trigger "t": conditions.all[1] (doc.notes) field "notes" is not captured for this collection',
    ])
  })
})

describe('conditions in triggers', () => {
  const users = [{ id: 'user_1', name: 'Alex', email: 'alex@example.com', tier: 'gold' }]
  const orders = [{ id: 'ORD-1', total: 9000, customer: 'user_1' }]

  const optionsWith = (trigger: Record<string, unknown>) =>
    normalizePluginOptions({
      channels: ['email', 'inapp'],
      events: { 'order.paid': { samplePayload: { orderId: 'ORD-1', total: 1 } } },
      data: { collections: { orders: { fields: ['total', 'customer'] } } },
      conditions: { always: () => true },
      triggers: [
        {
          slug: 'big-orders',
          event: 'order.paid',
          deliveries: [{ channel: 'email', template: 'order.paid' }],
          ...trigger,
        } as never,
      ],
    })

  it('fails normalization on invalid conditions and logs warnings for unknown payload paths', () => {
    expect(() =>
      optionsWith({ conditions: { field: 'order.total', operator: 'greaterThan', value: 1 } }),
    ).toThrow('unknown root "order"')

    const options = optionsWith({ conditions: { field: 'payload.missing', operator: 'exists' } })
    expect(collectTriggerWarnings(options)).toEqual([
      'trigger "big-orders": conditions (payload.missing) payload path "missing" is not in the event\'s samplePayload',
    ])
  })

  it('skips data loading when event-only conditions fail', async () => {
    const memory = createMemoryPayload({ users, orders })
    const options = optionsWith({
      conditions: { field: 'payload.total', operator: 'greaterThan', value: 5000 },
      data: {
        sources: [
          {
            type: 'collection',
            alias: 'order',
            collection: 'orders',
            lookup: { type: 'id', from: 'event.payload.orderId' },
            fields: ['total'],
          },
        ],
      },
    })
    const result = await processEvent({
      payload: memory.payload,
      event: { name: 'order.paid', userId: 'user_1', payload: { orderId: 'ORD-1', total: 10 } },
      options,
    })
    expect(result.deliveries).toEqual([])
    expect(memory.findByID).toHaveBeenCalledTimes(0)
  })

  it('evaluates data conditions after loading and delivery when per recipient', async () => {
    const memory = createMemoryPayload({ users, orders })
    const options = optionsWith({
      data: {
        sources: [
          {
            type: 'collection',
            alias: 'order',
            collection: 'orders',
            lookup: { type: 'id', from: 'event.payload.orderId' },
            fields: ['total', 'customer'],
          },
        ],
      },
      conditions: {
        all: [{ field: 'order.total', operator: 'greaterThan', value: 5000 }, { custom: 'always' }],
      },
      recipients: [
        { type: 'eventUser', alias: 'customer' },
        { type: 'static', email: 'ops@example.com', alias: 'ops' },
      ],
      deliveries: [
        // Only recipients with a user account get the in-app copy
        {
          channel: 'inapp',
          template: 'order.paid',
          when: { field: 'recipient.id', operator: 'exists' },
        },
        { channel: 'email', template: 'order.paid' },
      ],
    })
    await processEvent({
      payload: memory.payload,
      event: { name: 'order.paid', userId: 'user_1', payload: { orderId: 'ORD-1' } },
      options,
    })
    expect(
      memory
        .docs('notification-deliveries')
        .map((delivery) => [delivery.channel, delivery.recipientKey]),
    ).toEqual([
      ['inapp', 'user:user_1'],
      ['email', 'user:user_1'],
      ['email', 'email:ops@example.com'],
    ])
  })
})
