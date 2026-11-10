import { describe, expect, it } from 'bun:test'
import { normalizePluginOptions } from '../src/config/normalizePluginOptions'
import { eventIdFromKey, prepareNotificationEvent } from '../src/events/registry'

const options = (requireIdempotencyKey: boolean | ('transactional' | 'marketing')[]) =>
  normalizePluginOptions({
    requireIdempotencyKey,
    events: {
      'order.confirmed': { classification: 'transactional' },
      'newsletter.sent': { classification: 'marketing' },
    },
  })

describe('requireIdempotencyKey', () => {
  it('is off by default', async () => {
    const event = await prepareNotificationEvent(
      { name: 'order.confirmed', payload: {} },
      normalizePluginOptions({}),
    )
    expect(event.eventId).toStartWith('evt_')
  })

  it('normalizes true to every classification', () => {
    expect(options(true).requireIdempotencyKey).toEqual(['transactional', 'marketing'])
    expect(options(false).requireIdempotencyKey).toEqual([])
  })

  it('rejects a listed classification without a key', async () => {
    await expect(
      prepareNotificationEvent(
        { name: 'order.confirmed', payload: {} },
        options(['transactional']),
      ),
    ).rejects.toThrow('needs an idempotencyKey')
  })

  it('allows unlisted classifications without a key', async () => {
    const event = await prepareNotificationEvent(
      { name: 'newsletter.sent', payload: {} },
      options(['transactional']),
    )
    expect(event.eventId).toBeString()
  })

  it('never applies to collection events', async () => {
    const event = await prepareNotificationEvent(
      {
        name: 'collection.orders.update',
        source: { type: 'collection', collection: 'orders', operation: 'update' },
      },
      options(true),
    )
    expect(event.eventId).toBeString()
  })

  it('derives a stable eventId from the key', async () => {
    const opts = options(['transactional'])
    const a = await prepareNotificationEvent(
      { name: 'order.confirmed', idempotencyKey: 'order:7:confirmed:2' },
      opts,
    )
    const b = await prepareNotificationEvent(
      { name: 'order.confirmed', idempotencyKey: 'order:7:confirmed:2' },
      opts,
    )
    expect(a.eventId).toBe('evt_k_order:7:confirmed:2')
    expect(b.eventId).toBe(a.eventId)
    expect(eventIdFromKey(undefined)).toBeUndefined()
  })

  it('keeps an explicit eventId', async () => {
    const event = await prepareNotificationEvent(
      { name: 'order.confirmed', eventId: 'evt_custom', idempotencyKey: 'k' },
      options(true),
    )
    expect(event.eventId).toBe('evt_custom')
  })
})
