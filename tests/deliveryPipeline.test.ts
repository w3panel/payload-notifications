import { describe, expect, it, mock } from 'bun:test'
import { normalizePluginOptions } from '../src/config/normalizePluginOptions'
import { processEvent } from '../src/jobs/processEvent'
import { sendNotification } from '../src/jobs/sendNotification'
import { notificationsPlugin } from '../src/plugin'
import { createMemoryPayload } from './helpers/memoryPayload'

type Doc = Record<string, unknown>

const users = [
  { id: 'user_1', name: 'Alex', email: 'alex@example.com', phone: '+919876543210' },
  { id: 'user_2', name: 'Nopho', email: 'nopho@example.com' },
]

const options = normalizePluginOptions({
  channels: ['email', 'sms', 'inapp'],
  providers: {
    sms: { provider: 'twilio', accountSid: 'AC1', authToken: 't', from: '+15550000000' },
  },
  templates: {
    registry: {
      'order.paid': {
        email: { subject: 'Hi {{ recipient.name }}', body: 'Order {{ payload.orderId }}' },
        inapp: { title: 'Paid', body: 'Order {{ payload.orderId }}' },
      },
    },
  },
  triggers: [
    {
      slug: 'order-paid',
      event: 'order.paid',
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
  ],
})

const event = {
  name: 'order.paid',
  eventId: 'evt_1',
  userId: 'user_1',
  payload: { orderId: 'ORD-1' },
}

const sendQueued = async (memory: ReturnType<typeof createMemoryPayload>, index: number) => {
  const { input } = (memory.queue.mock.calls[index] as unknown as [{ input: Doc }])[0]
  return sendNotification({ payload: memory.payload, input: input as never, options })
}

describe('delivery planning', () => {
  it('creates one delivery per recipient × delivery and queues sends by deliveryId', async () => {
    const memory = createMemoryPayload({ users })
    const result = await processEvent({ payload: memory.payload, event, options })

    expect(result.matched).toEqual([
      { slug: 'order-paid', origin: 'code', version: 1, policy: 'independent' },
    ])
    const deliveries = memory.docs('notification-deliveries')
    expect(
      deliveries.map((delivery) => [delivery.channel, delivery.recipientKey, delivery.status]),
    ).toEqual([
      ['email', 'user:user_1', 'queued'],
      ['inapp', 'user:user_1', 'queued'],
      ['email', 'email:ops@example.com', 'queued'],
    ])
    expect(deliveries[0]).toMatchObject({
      eventId: 'evt_1',
      trigger: 'order-paid',
      triggerOrigin: 'code',
      triggerVersion: 1,
      destination: 'alex@example.com',
      destinationMasked: 'a***@example.com',
      idempotencyKey: 'evt_1::order-paid::user:user_1::email::order.paid',
    })
    expect(memory.queue).toHaveBeenCalledTimes(3)
    const { input } = (memory.queue.mock.calls[2] as unknown as [{ input: Doc }])[0]
    expect(input).toMatchObject({ deliveryId: deliveries[2].id, userId: '', channel: 'email' })
  })

  it('creates no new deliveries when the same event is processed again', async () => {
    const memory = createMemoryPayload({ users })
    await processEvent({ payload: memory.payload, event, options })
    const again = await processEvent({ payload: memory.payload, event, options })

    expect(memory.docs('notification-deliveries')).toHaveLength(3)
    expect(memory.queue).toHaveBeenCalledTimes(3)
    expect(again.deliveries.every((delivery) => delivery.status === 'existing')).toBe(true)
  })

  it('uses the caller idempotencyKey for the logical event', async () => {
    const memory = createMemoryPayload({ users })
    await processEvent({
      payload: memory.payload,
      event: { ...event, eventId: 'evt_a', idempotencyKey: 'order.paid:ORD-1' },
      options,
    })
    await processEvent({
      payload: memory.payload,
      event: { ...event, eventId: 'evt_b', idempotencyKey: 'order.paid:ORD-1' },
      options,
    })
    expect(memory.docs('notification-deliveries')).toHaveLength(3)
  })

  it('records a skipped delivery when the recipient has no destination', async () => {
    const memory = createMemoryPayload({ users })
    const smsOptions = normalizePluginOptions({
      channels: ['sms'],
      providers: options.providers,
      triggers: [
        { slug: 'sms', event: 'order.paid', deliveries: [{ channel: 'sms', template: 'x' }] },
      ],
    })
    await processEvent({
      payload: memory.payload,
      event: { ...event, userId: 'user_2' },
      options: smsOptions,
    })

    expect(memory.queue).toHaveBeenCalledTimes(0)
    expect(memory.docs('notification-deliveries')[0]).toMatchObject({
      status: 'skipped',
      skipReason: 'No sms destination for recipient',
    })
    expect(memory.docs('notification-logs')[0]).toMatchObject({ status: 'skipped' })
  })

  it('treats a unique-key race as an existing delivery', async () => {
    const memory = createMemoryPayload({ users })
    const realFind = memory.find.getMockImplementation()!
    let deliveryLookups = 0
    // First lookup misses (another worker has not committed yet); the create then collides.
    memory.find.mockImplementation(async (args: { collection: string }) => {
      if (args.collection === 'notification-deliveries' && deliveryLookups++ === 0)
        return { docs: [] }
      return realFind(args as never)
    })
    memory.db['notification-deliveries'] = [
      { id: 'existing', idempotencyKey: 'evt_1::order-paid::user:user_1::email::order.paid' },
    ]

    const result = await processEvent({ payload: memory.payload, event, options })
    expect(result.deliveries[0]).toMatchObject({ deliveryId: 'existing', status: 'existing' })
  })
})

describe('sending a delivery', () => {
  it('sends to the stored destination and records the outcome', async () => {
    const memory = createMemoryPayload({ users })
    await processEvent({ payload: memory.payload, event, options })

    const result = await sendQueued(memory, 0)
    expect(result?.status).toBe('sent')

    const email = memory.sendEmail.mock.calls[0][0] as unknown as Doc
    expect(email).toMatchObject({ to: 'alex@example.com', subject: 'Hi Alex' })

    const delivery = memory.docs('notification-deliveries')[0]
    expect(delivery).toMatchObject({ status: 'sent', attempts: 1 })
    expect(delivery.sentAt).toBeString()

    const log = memory.docs('notification-logs').at(-1) as Doc
    expect(log).toMatchObject({ status: 'sent', fingerprint: delivery.idempotencyKey })
    expect((log.meta as Doc).deliveryId).toBe(delivery.id)
  })

  it('sends to static recipients without a user lookup', async () => {
    const memory = createMemoryPayload({ users })
    await processEvent({ payload: memory.payload, event, options })
    await sendQueued(memory, 2)

    const email = memory.sendEmail.mock.calls[0][0] as unknown as Doc
    expect(email.to).toBe('ops@example.com')
    expect(email.subject).toBe('Hi ')
    expect(memory.docs('notification-deliveries')[2].status).toBe('sent')
  })

  it('stores in-app notifications for the recipient', async () => {
    const memory = createMemoryPayload({ users })
    await processEvent({ payload: memory.payload, event, options })
    await sendQueued(memory, 1)

    expect(memory.docs('notifications')[0]).toMatchObject({
      recipient: 'user_1',
      message: 'Order ORD-1',
    })
    expect(memory.docs('notification-deliveries')[1].status).toBe('sent')
  })

  it('never sends a final delivery twice', async () => {
    const memory = createMemoryPayload({ users })
    await processEvent({ payload: memory.payload, event, options })
    await sendQueued(memory, 0)
    const second = await sendQueued(memory, 0)

    expect(second).toMatchObject({ status: 'skipped', reason: 'Delivery already sent' })
    expect(memory.sendEmail).toHaveBeenCalledTimes(1)
  })

  it('fails the delivery when the recipient user was deleted before sending', async () => {
    const memory = createMemoryPayload({ users })
    await processEvent({ payload: memory.payload, event, options })
    memory.db.users = []

    const result = await sendQueued(memory, 0)
    expect(result).toMatchObject({ status: 'failed', reason: 'User not found' })
    expect(memory.docs('notification-deliveries')[0].status).toBe('failed')
  })

  it('re-queues retryable failures with a back-off instead of throwing', async () => {
    const sendEmail = mock(async () => {
      throw new Error('503 Service Unavailable')
    })
    const memory = createMemoryPayload({ users }, { sendEmail })
    await processEvent({ payload: memory.payload, event, options })

    const result = await sendQueued(memory, 0)
    expect(result?.status).toBe('queued')
    expect(memory.docs('notification-deliveries')[0]).toMatchObject({
      status: 'queued',
      attempts: 1,
      maxAttempts: 3,
      lastError: '503 Service Unavailable',
    })
    const retryJob = (memory.queue.mock.calls.at(-1) as unknown as [Doc])[0]
    expect(retryJob.waitUntil).toBeInstanceOf(Date)

    // The retry job sends the same delivery again
    sendEmail.mockImplementation(async () => undefined)
    const retry = await sendNotification({
      payload: memory.payload,
      input: retryJob.input as never,
      options,
    })
    expect(retry?.status).toBe('sent')
    expect(memory.docs('notification-deliveries')[0].attempts).toBe(2)
  })

  it('marks the delivery failed when the send job exhausts retries', async () => {
    const memory = createMemoryPayload({ users })
    const config = notificationsPlugin({
      triggers: options.triggers as never,
      channels: ['email', 'inapp'],
    })({
      collections: [],
    } as never)
    const tasks = (config.jobs as { tasks: Doc[] }).tasks
    const sendTask = tasks.find((task) => task.slug === 'notification:send') as {
      onFail: (args: unknown) => Promise<void>
      concurrency: (args: unknown) => string
    }

    memory.db['notification-deliveries'] = [{ id: 'd1', status: 'sending', idempotencyKey: 'k' }]
    await sendTask.onFail({
      input: { deliveryId: 'd1', userId: '', channel: 'email', template: 't', event: 'e' },
      job: { id: 'job_1', error: { message: 'SMTP timeout' } },
      req: { payload: memory.payload },
    })
    expect(memory.docs('notification-deliveries')[0]).toMatchObject({
      status: 'failed',
      lastError: 'SMTP timeout',
    })

    expect(sendTask.concurrency({ input: { deliveryId: 'd1' }, queue: 'notifications' })).toBe(
      'notifications::delivery::d1',
    )
  })
})
