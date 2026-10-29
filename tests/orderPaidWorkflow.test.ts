import { afterEach, describe, expect, it, mock } from 'bun:test'
import { collections, pluginOptions } from '../examples/order-paid'
import { emitNotificationEvent } from '../src/jobs/processEvent'
import { notificationsPlugin } from '../src/plugin'
import { createMemoryPayload } from './helpers/memoryPayload'

type Doc = Record<string, unknown>
type Task = {
  slug: string
  handler: (args: { input: Doc; job: Doc; req: Doc }) => Promise<unknown>
}

const originalFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = originalFetch
})

const seed = {
  users: [{ id: 'user_1', name: 'Alex', email: 'alex@example.com', phone: '098765 43210' }],
  stores: [{ id: 'store_1', name: 'TechNewWings Store', supportEmail: 'support@example.com' }],
  orders: [
    {
      id: 'ORD-1042',
      status: 'paid',
      total: 2499,
      customer: 'user_1',
      store: 'store_1',
      internalNotes: 'do not leak',
    },
  ],
}

/** Boots the plugin against the example collections and runs queued jobs in order. */
const boot = async () => {
  const memory = createMemoryPayload(seed)
  const config = notificationsPlugin(pluginOptions())({ collections } as never)
  // Like a real Payload instance, expose the built config (emit reads the plugin's registry from it).
  ;(memory.payload as unknown as { config: unknown }).config = config
  await config.onInit?.(memory.payload)

  const tasks = (config.jobs as { tasks: Task[] }).tasks
  const runTask = (slug: string, input: Doc) =>
    tasks
      .find((task) => task.slug === slug)!
      .handler({ input, job: { id: `job-${slug}` }, req: { payload: memory.payload } })

  /** Runs every queued job (including jobs queued by earlier jobs) once. */
  const drainQueue = async () => {
    for (let index = 0; index < memory.queue.mock.calls.length; index++) {
      const { task, input } = (
        memory.queue.mock.calls[index] as unknown as [{ task: string; input: Doc }]
      )[0]
      await runTask(task, input)
    }
  }

  return { memory, config, drainQueue }
}

describe('reference workflow: order.paid → customer email + WhatsApp + in-app', () => {
  it('validates the example configuration against its collections', () => {
    expect(() => notificationsPlugin(pluginOptions())({ collections } as never)).not.toThrow()
  })

  it('delivers on every channel with data from order, customer and store', async () => {
    const fetchMock = mock(async (_url: string, _init: { body: string }) => ({
      ok: true,
      status: 200,
      json: async () => ({ messages: [{ id: 'wamid.1' }], contacts: [{ wa_id: '919876543210' }] }),
    }))
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const { memory, drainQueue } = await boot()

    await emitNotificationEvent({
      payload: memory.payload,
      event: {
        name: 'order.paid',
        userId: 'user_1',
        idempotencyKey: 'order.paid:ORD-1042',
        payload: { orderId: 'ORD-1042' },
      },
    })
    await drainQueue()

    // Deliveries: one per channel for the customer, all sent
    const deliveries = memory.docs('notification-deliveries')
    expect(
      deliveries.map((delivery) => [delivery.channel, delivery.status, delivery.destinationMasked]),
    ).toEqual([
      ['email', 'sent', 'a***@example.com'],
      ['whatsapp', 'sent', '+91******3210'],
      // Short in-app destinations (user IDs) are fully masked
      ['inapp', 'sent', '***'],
    ])
    expect(deliveries.every((delivery) => delivery.trigger === 'order-paid-customer')).toBe(true)
    expect(deliveries.every((delivery) => delivery.attempts === 1)).toBe(true)
    expect(deliveries[1].providerMessageId).toBe('wamid.1')

    // Rendered output on every channel
    const email = memory.sendEmail.mock.calls[0][0] as unknown as Doc
    expect(email).toMatchObject({
      to: 'alex@example.com',
      subject: 'Order ORD-1042 confirmed',
      text: 'Hi Alex, your order ORD-1042 is confirmed. Total: 2499. Thanks for shopping with TechNewWings Store.',
    })
    expect(email.html).toContain('<strong>ORD-1042</strong>')

    const whatsapp = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(whatsapp).toMatchObject({
      to: '+919876543210',
      text: { body: 'Hi Alex, order ORD-1042 is confirmed (2499).' },
    })

    expect(memory.docs('notifications')[0]).toMatchObject({
      recipient: 'user_1',
      title: 'Order confirmed',
      message: 'Order ORD-1042 is confirmed.',
    })

    // One attempt log per delivery, linked by deliveryId
    const logs = memory.docs('notification-logs')
    expect(logs.map((log) => [log.channel, log.status])).toEqual([
      ['email', 'sent'],
      ['whatsapp', 'sent'],
      ['inapp', 'stored'],
    ])
    expect(logs.map((log) => (log.meta as Doc).deliveryId)).toEqual(deliveries.map((d) => d.id))

    // Only allowlisted fields were captured
    expect(JSON.stringify(deliveries[0].context)).not.toContain('do not leak')
  })

  it('does not notify twice for the same business event', async () => {
    globalThis.fetch = mock(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ messages: [{ id: 'wamid.1' }] }),
    })) as unknown as typeof fetch
    const { memory, drainQueue } = await boot()
    const emit = () =>
      emitNotificationEvent({
        payload: memory.payload,
        event: {
          name: 'order.paid',
          userId: 'user_1',
          idempotencyKey: 'order.paid:ORD-1042',
          payload: { orderId: 'ORD-1042' },
        },
      })

    await emit()
    await emit()
    await drainQueue()

    expect(memory.docs('notification-deliveries')).toHaveLength(3)
    expect(memory.sendEmail).toHaveBeenCalledTimes(1)
  })

  it('rejects an invalid event before anything is queued', async () => {
    const { memory } = await boot()
    await expect(
      emitNotificationEvent({
        payload: memory.payload,
        event: { name: 'order.paid', payload: {} },
      }),
    ).rejects.toThrow('orderId: Required')
    expect(memory.queue).toHaveBeenCalledTimes(0)
  })
})
