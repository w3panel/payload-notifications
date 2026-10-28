import { describe, expect, it, mock } from 'bun:test'
import {
  assertNotificationSendInput,
  queueNotificationSend,
  sendNotification,
} from '../src/jobs/sendNotification'
import { normalizePluginOptions } from '../src/config/normalizePluginOptions'

describe('sendNotification', () => {
  it('validates send input', () => {
    const input = assertNotificationSendInput({
      userId: 'user_1',
      channel: 'email',
      template: 'order.paid',
      event: 'order.paid',
    })

    expect(input.channel).toBe('email')
  })

  it('queues sends through helper API', async () => {
    const queue = mock(async () => undefined)
    const payload = {
      jobs: {
        queue,
      },
    }

    await queueNotificationSend({
      payload: payload as never,
      input: {
        userId: 'user_1',
        channel: 'email',
        template: 'order.paid',
        event: 'order.paid',
      },
    })

    expect(queue).toHaveBeenCalledTimes(1)
  })

  it('dispatches email notifications and writes a sent log', async () => {
    const sendEmail = mock(async () => undefined)
    const create = mock(async () => undefined)
    const findByID = mock(async () => ({ id: 'user_1', email: 'demo@example.com' }))
    const payload = {
      sendEmail,
      create,
      findByID,
    }

    const result = await sendNotification({
      payload: payload as never,
      input: {
        userId: 'user_1',
        channel: 'email',
        template: 'order.paid',
        event: 'order.paid',
        eventPayload: { orderId: 'ORD-1' },
      },
      options: normalizePluginOptions(),
    })

    expect(result?.status).toBe('sent')
    expect(sendEmail).toHaveBeenCalledTimes(1)
    expect(create).toHaveBeenCalledTimes(1)
    expect(sendEmail.mock.calls[0]?.[0]?.subject).toBe('Order ORD-1 paid')
  })

  it('applies templateOverrides before rendering email', async () => {
    const sendEmail = mock(async () => undefined)
    const create = mock(async () => undefined)
    const findByID = mock(async () => ({ id: 'user_1', email: 'demo@example.com' }))

    await sendNotification({
      payload: { sendEmail, create, findByID } as never,
      input: {
        userId: 'user_1',
        channel: 'email',
        template: 'order.paid',
        event: 'order.paid',
        eventPayload: { orderId: 'ORD-9' },
        templateOverrides: {
          subject: 'Custom {{ payload.orderId }}',
        },
      },
      options: normalizePluginOptions(),
    })

    expect(sendEmail.mock.calls[0]?.[0]?.subject).toBe('Custom ORD-9')
  })

  it('stores in-app notifications and logs them', async () => {
    const create = mock(async () => undefined)
    const findByID = mock(async () => ({ id: 'user_1', email: 'demo@example.com' }))
    const payload = {
      create,
      findByID,
    }

    const result = await sendNotification({
      payload: payload as never,
      input: {
        userId: 'user_1',
        channel: 'inapp',
        template: 'order.paid',
        event: 'order.paid',
      },
      options: normalizePluginOptions(),
    })

    expect(result?.status).toBe('stored')
    expect(create).toHaveBeenCalledTimes(2)
  })

  it('persists resolved template title and message for in-app notifications', async () => {
    const createCalls: any[] = []
    const create = mock(async (args: any) => {
      createCalls.push(args)
      return undefined
    })
    const findByID = mock(async () => ({ id: 'user_1' }))
    const payload = {
      create,
      findByID,
    }

    await sendNotification({
      payload: payload as never,
      input: {
        userId: 'user_1',
        channel: 'inapp',
        template: 'order.paid',
        event: 'order.paid',
        eventPayload: { orderId: 'ORD-123' },
      },
      options: normalizePluginOptions(),
    })

    // First create call is the notification record
    const notifData = createCalls[0]?.data
    expect(notifData.title).toBe('Order paid')
    expect(notifData.message).toBe('Order ORD-123 is now marked as paid.')
  })

  it('persists resolved template with token replacement for in-app', async () => {
    const createCalls: any[] = []
    const create = mock(async (args: any) => {
      createCalls.push(args)
      return undefined
    })
    const findByID = mock(async () => ({ id: 'user_1' }))
    const payload = {
      create,
      findByID,
    }

    await sendNotification({
      payload: payload as never,
      input: {
        userId: 'user_1',
        channel: 'inapp',
        template: 'order.shipped',
        event: 'order.shipped',
        eventPayload: { orderId: 'ORD-456' },
      },
      options: normalizePluginOptions(),
    })

    const notifData = createCalls[0]?.data
    expect(notifData.title).toBe('Order shipped')
    expect(notifData.message).toBe('Order ORD-456 has shipped.')
  })

  it('falls back to generic title when template has no title field', async () => {
    const createCalls: any[] = []
    const create = mock(async (args: any) => {
      createCalls.push(args)
      return undefined
    })
    const findByID = mock(async () => ({ id: 'user_1' }))
    const payload = {
      create,
      findByID,
    }

    await sendNotification({
      payload: payload as never,
      input: {
        userId: 'user_1',
        channel: 'inapp',
        template: 'custom.event',
        event: 'custom.event',
      },
      options: normalizePluginOptions({
        templates: {
          registry: {
            'custom.event': {
              inapp: 'Simple body-only template for {{ event }}',
            },
          },
        },
      }),
    })

    const notifData = createCalls[0]?.data
    expect(notifData.title).toBe('Notification: custom.event')
    expect(notifData.message).toBe('Simple body-only template for custom.event')
  })
})
