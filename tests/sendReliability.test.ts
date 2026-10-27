import { describe, expect, it, mock } from 'bun:test'
import { sendNotification } from '../src/jobs/sendNotification'
import { normalizePluginOptions } from '../src/config/normalizePluginOptions'

describe('sendNotification reliability behaviors', () => {
  it('skips duplicate sends using fingerprinted logs', async () => {
    const payload = {
      find: mock(async () => ({ docs: [{ id: 'log_1' }] })),
      findByID: mock(async () => ({ id: 'user_1' })),
      create: mock(async () => ({})),
      jobs: { queue: mock(async () => ({})) },
    } as any

    const result = await sendNotification({
      payload,
      input: {
        userId: 'user_1',
        channel: 'email',
        template: 'order.paid',
        event: 'order.paid',
        idempotencyKey: 'evt_1',
      },
      options: normalizePluginOptions(),
    })

    expect(result?.status).toBe('skipped')
    expect(result?.reason).toContain('Duplicate notification')
  })

  it('throws on retriable failures so Payload can retry the same job', async () => {
    const queue = mock(async () => ({}))
    const payload = {
      find: mock(async () => ({ docs: [] })),
      findByID: mock(async () => ({ id: 'user_1', email: 'user@example.com' })),
      create: mock(async () => ({})),
      sendEmail: mock(async () => {
        throw new Error('Provider timeout while sending')
      }),
      jobs: { queue },
    } as any

    await expect(
      sendNotification({
        payload,
        input: {
          userId: 'user_1',
          channel: 'email',
          template: 'order.paid',
          event: 'order.paid',
        },
        options: normalizePluginOptions(),
      }),
    ).rejects.toThrow('Provider timeout while sending')

    // Must not invent a second job — Payload retries the same job.
    expect(queue).toHaveBeenCalledTimes(0)
  })

  it('does not throw for terminal channel failures', async () => {
    const payload = {
      find: mock(async () => ({ docs: [] })),
      findByID: mock(async () => ({ id: 'user_1' })),
      create: mock(async () => ({})),
      jobs: { queue: mock(async () => ({})) },
    } as any

    const result = await sendNotification({
      payload,
      input: {
        userId: 'user_1',
        channel: 'email',
        template: 'order.paid',
        event: 'order.paid',
      },
      options: normalizePluginOptions(),
    })

    expect(result?.status).toBe('skipped')
    expect(result?.reason).toContain('email not found')
  })

  it('emits observability events through the configured hook', async () => {
    const onDispatch = mock(async () => ({}))
    const payload = {
      find: mock(async () => ({ docs: [{ id: 'log_1' }] })),
      findByID: mock(async () => ({ id: 'user_1' })),
      create: mock(async () => ({})),
      jobs: { queue: mock(async () => ({})) },
    } as any

    const options = normalizePluginOptions({
      observability: {
        onDispatch,
      },
    })

    await sendNotification({
      payload,
      input: {
        userId: 'user_1',
        channel: 'email',
        template: 'order.paid',
        event: 'order.paid',
        idempotencyKey: 'evt_9',
      },
      options,
    })

    expect(onDispatch).toHaveBeenCalled()
  })

  it('persists fingerprint on successful email delivery logs', async () => {
    const createCalls: any[] = []
    const payload = {
      find: mock(async () => ({ docs: [] })),
      findByID: mock(async () => ({ id: 'user_1', email: 'user@example.com' })),
      create: mock(async (args: any) => {
        createCalls.push(args)
        return {}
      }),
      sendEmail: mock(async () => undefined),
    } as any

    await sendNotification({
      payload,
      input: {
        userId: 'user_1',
        channel: 'email',
        template: 'order.paid',
        event: 'order.paid',
        idempotencyKey: 'evt_fingerprint',
      },
      options: normalizePluginOptions(),
    })

    const logData = createCalls.find((call) => call.collection === 'notification-logs')?.data
    expect(logData?.fingerprint).toContain('user_1::email::order.paid')
    expect(logData?.providerResponse?.provider).toBe('payload-email')
  })
})
