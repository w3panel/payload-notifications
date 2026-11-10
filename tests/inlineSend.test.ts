import { describe, expect, it } from 'bun:test'
import { normalizePluginOptions } from '../src/config/normalizePluginOptions'
import { processEvent } from '../src/jobs/processEvent'
import { createMemoryPayload } from './helpers/memoryPayload'

const users = [{ id: 'user_1', name: 'Alex', email: 'alex@example.com' }]

const build = (inlineSendLimit: number, extra: Record<string, unknown> = {}) =>
  normalizePluginOptions({
    channels: ['email', 'inapp'],
    jobs: { inlineSendLimit },
    templates: {
      registry: {
        'order.confirmed': {
          email: { subject: 'Order {{ payload.orderNumber }}', body: 'Confirmed' },
          inapp: { title: 'Confirmed', body: 'Order {{ payload.orderNumber }}' },
        },
      },
    },
    triggers: [
      {
        slug: 'order-confirmed',
        event: 'order.confirmed',
        recipients: [{ type: 'eventUser', alias: 'customer' }],
        deliveries: [
          { channel: 'email', template: 'order.confirmed', recipient: 'customer' },
          { channel: 'inapp', template: 'order.confirmed', recipient: 'customer' },
        ],
        ...extra,
      },
    ],
  })

const event = {
  name: 'order.confirmed',
  eventId: 'evt_1',
  userId: 'user_1',
  payload: { orderNumber: 'EF-1' },
}

describe('jobs.inlineSendLimit', () => {
  it('rejects invalid limits', () => {
    expect(() => build(-1)).toThrow('inlineSendLimit')
    expect(() => build(26)).toThrow('inlineSendLimit')
  })

  it('queues a job per delivery when off', async () => {
    const memory = createMemoryPayload({ users })
    await processEvent({ payload: memory.payload, event, options: build(0) })
    expect(memory.queue).toHaveBeenCalledTimes(2)
    expect(memory.docs('notification-deliveries').map((d) => d.status)).toEqual([
      'queued',
      'queued',
    ])
  })

  it('sends small plans inside the planning job', async () => {
    const memory = createMemoryPayload({ users })
    await processEvent({ payload: memory.payload, event, options: build(5) })
    expect(memory.queue).not.toHaveBeenCalled()
    expect(memory.sendEmail).toHaveBeenCalledTimes(1)
    expect(memory.docs('notification-deliveries').map((d) => d.status)).toEqual(['sent', 'sent'])
  })

  it('queues everything when the plan is larger than the limit', async () => {
    const memory = createMemoryPayload({ users })
    await processEvent({ payload: memory.payload, event, options: build(1) })
    expect(memory.queue).toHaveBeenCalledTimes(2)
    expect(memory.sendEmail).not.toHaveBeenCalled()
  })

  it('does not send again when the job is retried', async () => {
    const memory = createMemoryPayload({ users })
    const options = build(5)
    await processEvent({ payload: memory.payload, event, options })
    await processEvent({ payload: memory.payload, event, options })
    expect(memory.sendEmail).toHaveBeenCalledTimes(1)
    expect(memory.queue).not.toHaveBeenCalled()
  })

  it('falls back to a send job when the inline send throws unexpectedly', async () => {
    const memory = createMemoryPayload({ users })
    const original = memory.payload.findByID
    let calls = 0
    memory.payload.findByID = (async (args: { collection: string }) => {
      if (args.collection === 'notification-deliveries' && calls++ === 0) {
        throw new Error('db hiccup')
      }
      return (original as (a: unknown) => unknown)(args)
    }) as never
    await processEvent({ payload: memory.payload, event, options: build(5) })
    expect(memory.queue).toHaveBeenCalledTimes(1)
  })
})
