import { describe, expect, it, mock } from 'bun:test'
import { normalizePluginOptions } from '../src/config/normalizePluginOptions'
import { processEvent } from '../src/jobs/processEvent'
import { sendNotification } from '../src/jobs/sendNotification'
import { emitLifecycle, maskRecipientKey } from '../src/observability'
import { ProviderError } from '../src/providers/errors'
import type {
  NotificationLifecycleEvent,
  NotificationProvider,
  ObservabilityEvent,
} from '../src/types'
import { createMemoryPayload } from './helpers/memoryPayload'

type Doc = Record<string, unknown>

describe('lifecycle observability', () => {
  it('masks static recipients but keeps user keys', () => {
    expect(maskRecipientKey('user:u1')).toBe('user:u1')
    expect(maskRecipientKey('email:ops@example.com')).toBe('email:o***@example.com')
    expect(maskRecipientKey('phone:+919876543210')).toBe('phone:+91******3210')
  })

  it('reports every stage of a delivery and enriches onDispatch', async () => {
    const stages: NotificationLifecycleEvent[] = []
    const dispatches: ObservabilityEvent[] = []
    let failSms = true
    const sms: NotificationProvider = {
      name: 'sms-test',
      channels: ['sms'],
      capabilities: { html: false, hsm: false, media: false },
      send: async () => {
        if (failSms) throw new ProviderError('Rate limited', { status: 429 })
        return { status: 'sent', providerMessageId: 'SM1' }
      },
    }
    const options = normalizePluginOptions({
      channels: ['sms', 'email'],
      providers: { custom: { sms } },
      observability: {
        onEvent: (event) => {
          stages.push(event)
        },
        onDispatch: (event) => {
          dispatches.push(event)
        },
      },
      triggers: [
        {
          slug: 'otp',
          event: 'auth.otp',
          recipients: [
            { type: 'eventUser' },
            { type: 'static', email: 'ops@example.com', alias: 'ops' },
          ],
          deliveries: [
            { channel: 'sms', template: 'order.paid', recipient: 'user' },
            { channel: 'sms', template: 'order.paid', recipient: 'ops' },
          ],
        },
      ],
    })
    const memory = createMemoryPayload({ users: [{ id: 'u1', phone: '+919876543210' }] })
    await processEvent({
      payload: memory.payload,
      event: { name: 'auth.otp', eventId: 'e1', userId: 'u1' },
      options,
    })

    const job = (memory.queue.mock.calls[0] as unknown as [{ input: Doc }])[0]
    await sendNotification({ payload: memory.payload, input: job.input as never, options })
    failSms = false
    const retry = (memory.queue.mock.calls.at(-1) as unknown as [{ input: Doc }])[0]
    await sendNotification({ payload: memory.payload, input: retry.input as never, options })

    expect(stages.map((event) => [event.stage, event.recipient])).toEqual([
      ['matched', undefined],
      ['planned', 'user:u1'],
      ['skipped', 'email:o***@example.com'],
      ['retrying', 'user:u1'],
      ['sent', 'user:u1'],
    ])
    expect(stages[0]).toMatchObject({
      trigger: 'otp',
      triggerSource: 'code',
      triggerVersion: 1,
      eventId: 'e1',
    })
    expect(stages[2].reason).toBe('No sms destination for recipient')
    expect(stages[4]).toMatchObject({ provider: 'sms-test', providerMessageId: 'SM1', attempt: 2 })
    expect(typeof stages[4].durationMs).toBe('number')

    expect(dispatches.map((event) => event.stage)).toEqual(['retrying', 'sent'])
    expect(dispatches[1]).toMatchObject({
      trigger: 'otp',
      triggerSource: 'code',
      eventId: 'e1',
      deliveryId: stages[1].deliveryId,
    })
  })

  it('logs structured events when enabled and never lets hook errors break sends', async () => {
    const memory = createMemoryPayload()
    const options = normalizePluginOptions({
      observability: {
        log: true,
        onEvent: () => {
          throw new Error('dashboard down')
        },
      },
    })
    await emitLifecycle(memory.payload, options, {
      stage: 'failed',
      trigger: 't',
      reason: 'x',
      recipient: 'email:a@b.co',
    })
    expect(memory.logger.warn).toHaveBeenCalledTimes(1)
    const [entry, message] = memory.logger.warn.mock.calls[0] as unknown as [Doc, string]
    expect(entry).toMatchObject({
      type: 'notification.lifecycle',
      stage: 'failed',
      recipient: 'email:a***@b.co',
    })
    expect(message).toBe('payload-notifications: failed t')
    expect(memory.logger.error).toHaveBeenCalledTimes(1)
  })

  it('does nothing when no observability is configured', async () => {
    const memory = createMemoryPayload()
    const onEvent = mock(() => undefined)
    await emitLifecycle(memory.payload, normalizePluginOptions(), { stage: 'sent' })
    expect(onEvent).toHaveBeenCalledTimes(0)
    expect(memory.logger.info).toHaveBeenCalledTimes(0)
  })
})
