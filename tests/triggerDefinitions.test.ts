import { describe, expect, it } from 'bun:test'
import { normalizePluginOptions } from '../src/config/normalizePluginOptions'
import { defineTrigger, isValidEventPattern, ruleToTrigger } from '../src/triggers'
import { compileCodeTriggers } from '../src/triggers/compile'

const orderPaid = {
  slug: 'order-paid-customer',
  event: 'order.paid',
  recipients: [{ type: 'context' as const, path: 'customer.id', alias: 'customer' }],
  deliveries: [
    { channel: 'email' as const, template: 'order.paid', recipient: 'customer' },
    { channel: 'inapp' as const, template: 'order.paid', recipient: 'customer' },
  ],
}

describe('defineTrigger v2', () => {
  it('expands the event shorthand into a source and defaults enabled', () => {
    const trigger = defineTrigger(orderPaid)
    expect(trigger.source).toEqual({ type: 'event', event: 'order.paid' })
    expect(trigger.enabled).toBe(true)
    expect(trigger).not.toHaveProperty('event')
  })

  it('accepts explicit event and collection sources', () => {
    expect(
      defineTrigger({
        ...orderPaid,
        event: undefined,
        source: { type: 'event', event: 'order.*' },
      } as never).source,
    ).toEqual({ type: 'event', event: 'order.*' })

    const collection = defineTrigger({
      slug: 'order-updated',
      source: { type: 'collection', collection: 'orders', operation: 'update' },
      deliveries: [{ channel: 'email', template: 'order.updated' }],
    })
    expect(collection.source).toEqual({
      type: 'collection',
      collection: 'orders',
      operation: 'update',
    })
  })

  it('rejects invalid shapes with every problem listed', () => {
    expect(() =>
      defineTrigger({
        slug: 'bad slug',
        event: 'order paid',
        deliveries: [{ channel: 'email', template: '' }],
        admin: { policy: 'locked' as never },
      }),
    ).toThrow(
      'trigger "bad slug": slug must use letters, numbers and single . _ : - separators (e.g. order-paid); trigger "bad slug": source.event must be an event name or a trailing wildcard (order.*); trigger "bad slug": deliveries[0].template is required; trigger "bad slug": admin.policy must be independent, managed or enforced',
    )
    expect(() => defineTrigger({ slug: 'x', event: 'a.b', deliveries: [] })).toThrow(
      'at least one delivery is required',
    )
    expect(() =>
      defineTrigger({
        slug: 'x',
        source: { type: 'collection', collection: 'orders', operation: 'upsert' as never },
        deliveries: [{ channel: 'email', template: 't' }],
      }),
    ).toThrow('source.operation must be create, update or delete')
  })

  it('still returns legacy rules unchanged', () => {
    const rule = defineTrigger({ event: 'order.paid', channels: ['email'], template: 'order.paid' })
    expect(rule).toEqual({
      enabled: true,
      event: 'order.paid',
      channels: ['email'],
      template: 'order.paid',
    })
  })

  it('validates event patterns', () => {
    for (const pattern of ['order.paid', 'order.*', '*', 'user:signup']) {
      expect(isValidEventPattern(pattern)).toBe(true)
    }
    for (const pattern of ['order.*.paid', 'order*', '.*', 'order paid']) {
      expect(isValidEventPattern(pattern)).toBe(false)
    }
  })
})

describe('ruleToTrigger', () => {
  it('compiles a rule into one delivery per channel to the event user', () => {
    const condition = () => true
    const trigger = ruleToTrigger(
      {
        event: 'order.paid',
        channels: ['email', 'sms'],
        template: 'order.paid',
        enabled: false,
        condition,
        templateOverrides: { email: { subject: 'S' } },
        data: { sources: [] },
      },
      3,
    )
    expect(trigger).toEqual({
      slug: 'rule-3-order.paid',
      source: { type: 'event', event: 'order.paid' },
      enabled: false,
      condition,
      data: { sources: [] },
      recipients: [{ type: 'eventUser', alias: 'user' }],
      deliveries: [
        {
          channel: 'email',
          template: 'order.paid',
          recipient: 'user',
          templateOverrides: { subject: 'S' },
        },
        { channel: 'sms', template: 'order.paid', recipient: 'user', templateOverrides: undefined },
      ],
    })
  })
})

describe('code trigger compilation', () => {
  it('puts compiled rules first, then triggers', () => {
    const options = normalizePluginOptions({
      rules: [{ event: 'order.shipped', channels: ['email'], template: 'order.shipped' }],
      triggers: [orderPaid],
    })
    expect(options.triggers.map((trigger) => trigger.slug)).toEqual([
      'rule-0-order.shipped',
      'order-paid-customer',
    ])
    expect(options.rules).toHaveLength(1)
  })

  it('rejects duplicate code trigger slugs', () => {
    expect(() => compileCodeTriggers([], [orderPaid, orderPaid])).toThrow(
      'trigger "order-paid-customer": duplicate slug',
    )
  })

  it('validates v2 trigger data sources against the allowlist', () => {
    expect(() =>
      normalizePluginOptions({
        triggers: [
          {
            ...orderPaid,
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
          },
        ],
      }),
    ).toThrow(
      'trigger "order-paid-customer" source "order": collection "orders" is not allowlisted',
    )
  })
})
