import { describe, expect, it } from 'bun:test'
import type { Field } from 'payload'
import { NotificationEventsCollection } from '../src/collections/NotificationEvents'
import { normalizePluginOptions } from '../src/config/normalizePluginOptions'
import { replayNotificationEvent } from '../src/events/inbox'
import { emitNotificationEvent, processEvent } from '../src/jobs/processEvent'
import { registerCollections } from '../src/plugin'
import { createMemoryPayload } from './helpers/memoryPayload'

type Doc = Record<string, unknown>

const options = normalizePluginOptions({
  eventsInbox: true,
  triggers: [
    {
      slug: 'paid',
      event: 'order.paid',
      deliveries: [{ channel: 'email', template: 'order.paid' }],
    },
  ],
})

const setup = () => {
  const memory = createMemoryPayload({ users: [{ id: 'u1', email: 'u1@example.com' }] })
  return memory
}

const runQueuedProcessJobs = async (memory: ReturnType<typeof setup>, from = 0) => {
  const calls = memory.queue.mock.calls.slice(from) as unknown as Array<
    [{ task: string; input: Doc }]
  >
  for (const [job] of calls) {
    if (job.task === 'notification:process-event') {
      await processEvent({ payload: memory.payload, event: job.input as never, options })
    }
  }
}

describe('events inbox', () => {
  it('is registered only when enabled and keeps the raw event server-only', () => {
    expect(registerCollections([], normalizePluginOptions()).map((c) => c.slug)).not.toContain(
      'notification-events',
    )
    expect(registerCollections([], options).map((c) => c.slug)).toContain('notification-events')

    const collection = NotificationEventsCollection()
    const field = (name: string) =>
      collection.fields.find((entry) => 'name' in entry && entry.name === name) as Field & {
        access?: { read?: () => boolean }
        unique?: boolean
      }
    expect(field('eventId').unique).toBe(true)
    expect(field('event').access?.read?.()).toBe(false)
  })

  it('records the event with the request and tracks processing', async () => {
    const memory = setup()
    const req = { context: {}, transactionID: 'tx' }
    const event = await emitNotificationEvent({
      payload: memory.payload,
      event: { name: 'order.paid', userId: 'u1', payload: { orderId: 'o1', magicLink: 'secret' } },
      options,
      req: req as never,
    })

    const [record] = memory.docs('notification-events')
    expect(record).toMatchObject({
      eventId: event.eventId,
      name: 'order.paid',
      sourceType: 'application',
      userId: 'u1',
      status: 'received',
    })
    expect((memory.create.mock.calls[0][0] as unknown as Doc).req).toBe(req)

    await runQueuedProcessJobs(memory)
    expect(memory.docs('notification-events')[0]).toMatchObject({
      status: 'processed',
      attempts: 1,
      deliveries: 1,
      matched: [{ slug: 'paid', origin: 'code', version: 1, policy: 'independent' }],
    })
    expect(memory.docs('notification-events')[0].processedAt).toBeString()
  })

  it('does not queue an eventId twice', async () => {
    const memory = setup()
    const event = { name: 'order.paid', eventId: 'evt_fixed', userId: 'u1' }
    await emitNotificationEvent({ payload: memory.payload, event, options })
    await emitNotificationEvent({ payload: memory.payload, event, options })
    expect(memory.docs('notification-events')).toHaveLength(1)
    expect(memory.queue).toHaveBeenCalledTimes(1)
  })

  it('marks failures and rethrows for the job', async () => {
    const memory = setup()
    await emitNotificationEvent({
      payload: memory.payload,
      event: { name: 'order.paid', eventId: 'evt_fail', userId: 'u1' },
      options,
    })
    const originalFind = memory.find.getMockImplementation()!
    memory.find.mockImplementation(async (args: { collection: string }) => {
      if (args.collection === 'users') throw new Error('db down')
      return originalFind(args as never)
    })
    await expect(runQueuedProcessJobs(memory)).rejects.toThrow('db down')
    expect(memory.docs('notification-events')[0]).toMatchObject({
      status: 'failed',
      error: 'db down',
    })
  })

  it('replays a stored event without duplicating deliveries', async () => {
    const memory = setup()
    await emitNotificationEvent({
      payload: memory.payload,
      event: { name: 'order.paid', eventId: 'evt_r', userId: 'u1' },
      options,
    })
    await runQueuedProcessJobs(memory)

    const replayed = await replayNotificationEvent({
      payload: memory.payload,
      options,
      eventId: 'evt_r',
    })
    expect(replayed.eventId).toBe('evt_r')
    expect(memory.docs('notification-events')[0].status).toBe('received')
    await runQueuedProcessJobs(memory, 2)

    expect(memory.docs('notification-deliveries')).toHaveLength(1)
    expect(memory.docs('notification-events')[0]).toMatchObject({
      status: 'processed',
      attempts: 2,
      deliveries: 0,
    })

    await expect(
      replayNotificationEvent({ payload: memory.payload, options, eventId: 'missing' }),
    ).rejects.toThrow('is not in the inbox')
    await expect(
      replayNotificationEvent({
        payload: memory.payload,
        options: normalizePluginOptions(),
        eventId: 'evt_r',
      }),
    ).rejects.toThrow('requires eventsInbox: true')
  })
})
