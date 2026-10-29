import { describe, expect, it, mock } from 'bun:test'
import { normalizePluginOptions } from '../src/config/normalizePluginOptions'
import { PLUGIN_CUSTOM_KEY } from '../src/config/runtime'
import { createEventsListHandler } from '../src/endpoints/events'
import {
  collectFieldPaths,
  listRegisteredEvents,
  prepareNotificationEvent,
} from '../src/events/registry'
import { emitNotificationEvent } from '../src/jobs/processEvent'
import { notificationsPlugin } from '../src/plugin'
import type { StandardSchemaV1Like } from '../src/types'

/** Tiny Standard Schema: requires a string `orderId`, coerces `total` to number. */
const orderPaidSchema: StandardSchemaV1Like = {
  '~standard': {
    version: 1,
    vendor: 'test',
    validate: (value) => {
      const input = value as Record<string, unknown>
      if (typeof input.orderId !== 'string') {
        return { issues: [{ message: 'Required', path: ['orderId'] }] }
      }
      return { value: { ...input, total: Number(input.total ?? 0) } }
    },
  },
}

const optionsWithEvents = (strict = false) =>
  normalizePluginOptions({
    eventsStrict: strict,
    events: {
      'order.paid': {
        label: 'Order Paid',
        classification: 'transactional',
        schema: orderPaidSchema,
        samplePayload: { orderId: 'ORD-1', total: 10, items: [{ sku: 'A', qty: 1 }] },
      },
      'newsletter.sent': {
        classification: 'marketing',
        schema: (payload) => {
          if (!payload.campaign) throw new Error('campaign is required')
          return payload
        },
      },
    },
  })

describe('event registry options', () => {
  it('defaults to an empty, non-strict registry', () => {
    const options = normalizePluginOptions()
    expect(options.events).toEqual({})
    expect(options.eventsStrict).toBe(false)
  })

  it('rejects invalid event names', () => {
    expect(() => normalizePluginOptions({ events: { 'order paid': {} } })).toThrow(
      'invalid event name "order paid"',
    )
  })

  it('rejects invalid classification and schema', () => {
    expect(() =>
      normalizePluginOptions({ events: { 'a.b': { classification: 'promo' as never } } }),
    ).toThrow('classification')
    expect(() =>
      normalizePluginOptions({ events: { 'a.b': { schema: 'nope' as never } } }),
    ).toThrow('Standard Schema')
  })
})

describe('prepareNotificationEvent', () => {
  it('fills eventId, occurredAt and default classification', async () => {
    const event = await prepareNotificationEvent(
      { name: 'order.paid', payload: { orderId: 'ORD-1', total: '25' } },
      optionsWithEvents(),
    )
    expect(event.eventId).toMatch(/^evt_/)
    expect(Number.isNaN(Date.parse(event.occurredAt!))).toBe(false)
    expect(event.classification).toBe('transactional')
    expect(event.payload).toEqual({ orderId: 'ORD-1', total: 25 })
  })

  it('keeps caller-provided identifiers and classification', async () => {
    const event = await prepareNotificationEvent(
      {
        name: 'order.paid',
        eventId: 'evt_fixed',
        occurredAt: '2026-01-01T00:00:00.000Z',
        classification: 'marketing',
        payload: { orderId: 'ORD-1' },
      },
      optionsWithEvents(),
    )
    expect(event.eventId).toBe('evt_fixed')
    expect(event.occurredAt).toBe('2026-01-01T00:00:00.000Z')
    expect(event.classification).toBe('marketing')
  })

  it('reports schema issues with event name and path', async () => {
    await expect(
      prepareNotificationEvent({ name: 'order.paid', payload: {} }, optionsWithEvents()),
    ).rejects.toThrow('invalid payload for event "order.paid": orderId: Required')
  })

  it('wraps validator function errors', async () => {
    await expect(
      prepareNotificationEvent({ name: 'newsletter.sent', payload: {} }, optionsWithEvents()),
    ).rejects.toThrow('invalid payload for event "newsletter.sent": campaign is required')
  })

  it('allows unregistered events unless strict', async () => {
    const loose = await prepareNotificationEvent({ name: 'other.event' }, optionsWithEvents())
    expect(loose.eventId).toMatch(/^evt_/)

    await expect(
      prepareNotificationEvent({ name: 'other.event' }, optionsWithEvents(true)),
    ).rejects.toThrow('event "other.event" is not registered')
  })

  it('works without plugin options', async () => {
    const event = await prepareNotificationEvent({ name: 'x.y', payload: { a: 1 } })
    expect(event.payload).toEqual({ a: 1 })
    expect(event.eventId).toBeString()
  })
})

describe('emitNotificationEvent with registry', () => {
  const payloadWithPlugin = (options = optionsWithEvents()) => {
    const queue = mock(async () => undefined)
    return {
      queue,
      payload: {
        config: { custom: { [PLUGIN_CUSTOM_KEY]: { getOptions: () => options } } },
        jobs: { queue },
      },
    }
  }

  it('validates via the installed plugin options and queues the prepared event', async () => {
    const options = normalizePluginOptions({
      jobs: { queue: 'custom-queue' },
      events: { 'order.paid': { schema: orderPaidSchema } },
    })
    const { payload, queue } = payloadWithPlugin(options)

    const event = await emitNotificationEvent({
      payload: payload as never,
      event: { name: 'order.paid', userId: 'u1', payload: { orderId: 'ORD-9' } },
    })

    expect(queue).toHaveBeenCalledTimes(1)
    const call = (queue.mock.calls[0] as unknown[])[0] as { queue: string; input: unknown }
    expect(call.queue).toBe('custom-queue')
    expect(call.input).toEqual(event)
    expect(event.eventId).toMatch(/^evt_/)
  })

  it('does not queue an invalid event', async () => {
    const { payload, queue } = payloadWithPlugin()
    await expect(
      emitNotificationEvent({ payload: payload as never, event: { name: 'order.paid' } }),
    ).rejects.toThrow('orderId: Required')
    expect(queue).toHaveBeenCalledTimes(0)
  })
})

describe('registered event listing', () => {
  it('collects payload field paths from samples', () => {
    expect(collectFieldPaths({ a: 1, b: { c: 'x' }, items: [{ sku: 'A' }] })).toEqual([
      'a',
      'b.c',
      'items',
      'items.0.sku',
    ])
  })

  it('lists events sorted with labels and fields', () => {
    const events = listRegisteredEvents(optionsWithEvents())
    expect(events.map((event) => event.name)).toEqual(['newsletter.sent', 'order.paid'])
    const orderPaid = events[1]
    expect(orderPaid.label).toBe('Order Paid')
    expect(orderPaid.hasSchema).toBe(true)
    expect(orderPaid.fields).toEqual(['orderId', 'total', 'items', 'items.0.sku', 'items.0.qty'])
    expect(events[0].label).toBe('newsletter.sent')
  })

  it('events endpoint requires a user', async () => {
    const handler = createEventsListHandler(() => optionsWithEvents())
    const denied = await handler({ user: null } as never)
    expect(denied.status).toBe(401)

    const ok = await handler({ user: { id: 'admin' } } as never)
    const body = await ok.json()
    expect(body.events).toHaveLength(2)
  })

  it('plugin exposes runtime options and the events endpoint', () => {
    const config = notificationsPlugin({ events: { 'order.paid': {} } })({} as never)
    expect(Object.keys(config.custom?.[PLUGIN_CUSTOM_KEY].getOptions().events)).toContain(
      'order.paid',
    )
    expect(config.endpoints?.map((endpoint) => endpoint.path)).toContain('/notifications/events')
  })
})
