import { describe, expect, it, mock } from 'bun:test'
import type { Field } from 'payload'
import { NotificationDeliveriesCollection } from '../src/collections/NotificationDeliveries'
import { normalizePluginOptions } from '../src/config/normalizePluginOptions'
import { notificationsPlugin } from '../src/plugin'
import { collectTriggerWarnings, validateTrigger } from '../src/triggers'

const options = normalizePluginOptions({ channels: ['email', 'inapp'] })

describe('validateTrigger', () => {
  it('accepts deliveries to defined recipients on enabled channels', () => {
    expect(
      validateTrigger(
        {
          slug: 'order-paid',
          source: { type: 'event', event: 'order.paid' },
          recipients: [
            { type: 'eventUser', alias: 'customer' },
            { type: 'static', email: 'ops@example.com', alias: 'ops' },
          ],
          deliveries: [
            { channel: 'email', template: 'order.paid', recipient: 'customer' },
            { channel: 'inapp', template: 'order.paid', recipient: 'customer' },
            { channel: 'email', template: 'order.paid', recipient: 'ops' },
          ],
        },
        options,
      ),
    ).toEqual({ errors: [], warnings: [] })
  })

  it('reports unknown aliases, disabled channels, static in-app and duplicates', () => {
    const { errors } = validateTrigger(
      {
        slug: 't',
        source: { type: 'event', event: 'order.paid' },
        recipients: [{ type: 'static', email: 'ops@example.com', alias: 'ops' }],
        deliveries: [
          { channel: 'email', template: 'x', recipient: 'customer' },
          { channel: 'sms', template: 'x', recipient: 'ops' },
          { channel: 'inapp', template: 'x', recipient: 'ops' },
          { channel: 'email', template: 'y', recipient: 'ops' },
          { channel: 'email', template: 'y', recipient: 'ops' },
        ],
      },
      options,
    )
    expect(errors).toEqual([
      'trigger "t" deliveries[0]: recipient "customer" is not defined in recipients',
      'trigger "t" deliveries[1]: channel "sms" is not enabled in plugin channels',
      'trigger "t" deliveries[2]: static recipient "ops" has no in-app destination',
      'trigger "t" deliveries[4]: duplicate delivery (email → ops)',
    ])
  })

  it('warns when a registry template lacks the delivery channel', () => {
    const withRegistry = normalizePluginOptions({
      channels: ['email', 'inapp'],
      templates: { registry: { 'ops.alert': { email: 'Alert' } } },
      triggers: [
        {
          slug: 'ops-alert',
          event: 'system.alert',
          deliveries: [
            { channel: 'email', template: 'ops.alert' },
            { channel: 'inapp', template: 'ops.alert' },
          ],
        },
      ],
    })
    expect(collectTriggerWarnings(withRegistry)).toEqual([
      'trigger "ops-alert" deliveries[1]: template "ops.alert" has no inapp variant in the code registry; an active notification-templates document must provide it',
    ])
  })

  it('fails option normalization for invalid v2 triggers but not legacy rules', () => {
    expect(() =>
      normalizePluginOptions({
        channels: ['email'],
        triggers: [{ slug: 't', event: 'a.b', deliveries: [{ channel: 'sms', template: 'x' }] }],
      }),
    ).toThrow('invalid triggers\n  - trigger "t" deliveries[0]: channel "sms" is not enabled')

    expect(() =>
      normalizePluginOptions({
        channels: ['email'],
        rules: [{ event: 'a.b', channels: ['email', 'sms'], template: 'x' }],
      }),
    ).not.toThrow()
  })

  it('logs trigger warnings on init', async () => {
    const warn = mock(() => undefined)
    const config = notificationsPlugin({
      templates: { registry: { only: { email: 'x' } } },
      triggers: [{ slug: 's', event: 'a.b', deliveries: [{ channel: 'inapp', template: 'only' }] }],
    })({ collections: [] } as never)
    await config.onInit?.({ logger: { warn } } as never)
    expect(warn).toHaveBeenCalledTimes(1)
  })
})

describe('notification-deliveries collection', () => {
  const collection = NotificationDeliveriesCollection()
  const field = (name: string) =>
    collection.fields.find((entry) => 'name' in entry && entry.name === name) as Field & {
      access?: { read?: () => boolean }
      unique?: boolean
      admin?: { hidden?: boolean }
    }

  it('is read-only through the API and keys deliveries uniquely', () => {
    expect(collection.slug).toBe('notification-deliveries')
    const access = collection.access as Record<string, (args: unknown) => unknown>
    expect(access.create({})).toBe(false)
    expect(access.update({})).toBe(false)
    expect(access.read({ req: { user: { id: 'a' } } })).toBe(true)
    expect(access.read({ req: { user: null } })).toBe(false)
    expect(field('idempotencyKey').unique).toBe(true)
  })

  it('hides raw destinations and context from the API and admin', () => {
    for (const name of ['destination', 'context', 'templateOverrides']) {
      expect(field(name).access?.read?.()).toBe(false)
      expect(field(name).admin?.hidden).toBe(true)
    }
    expect(field('destinationMasked')).toBeDefined()
  })

  it('supports a custom slug through plugin options', () => {
    expect(() =>
      normalizePluginOptions({ collections: { deliveries: 'notification-logs' } }),
    ).toThrow('events collections must use different slugs')
    expect(
      normalizePluginOptions({ collections: { deliveries: 'sends' } }).collections.deliveries,
    ).toBe('sends')
  })
})
