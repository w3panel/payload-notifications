import { describe, expect, it, mock } from 'bun:test'
import { normalizePluginOptions } from '../src/config/normalizePluginOptions'
import { callProvider } from '../src/deliveries/providerCall'
import { resolveRetryPolicy, retryDelayMs } from '../src/deliveries/retry'
import { processEvent } from '../src/jobs/processEvent'
import { sendNotification } from '../src/jobs/sendNotification'
import { classifySendFailure, kindForStatus, ProviderError } from '../src/providers/errors'
import type { NotificationProvider, NotificationsPluginOptions } from '../src/types'
import { createMemoryPayload } from './helpers/memoryPayload'

type Doc = Record<string, unknown>

const users = [{ id: 'u1', name: 'Alex', email: 'alex@example.com', phone: '+919876543210' }]

const smsProvider = (send: NotificationProvider['send']): NotificationProvider => ({
  name: 'test-sms',
  channels: ['sms'],
  capabilities: { html: false, hsm: false, media: false, maxLength: 160 },
  send,
})

const base = (provider: NotificationProvider, extra: Partial<NotificationsPluginOptions> = {}) =>
  normalizePluginOptions({
    channels: ['sms', 'email'],
    providers: { custom: { sms: provider }, timeoutMs: 100 },
    templates: {
      registry: { hello: { sms: 'Hi {{ recipient.name }}', email: { subject: 'S', body: 'B' } } },
    },
    triggers: [
      { slug: 'hello', event: 'hello.sent', deliveries: [{ channel: 'sms', template: 'hello' }] },
    ],
    ...extra,
  })

const run = async (options: ReturnType<typeof base>, memory = createMemoryPayload({ users })) => {
  await processEvent({
    payload: memory.payload,
    event: { name: 'hello.sent', eventId: 'e1', userId: 'u1' },
    options,
  })
  const job = (memory.queue.mock.calls[0] as unknown as [{ input: Doc }])[0]
  const result = await sendNotification({
    payload: memory.payload,
    input: job.input as never,
    options,
  })
  return {
    memory,
    result,
    delivery: memory.docs('notification-deliveries')[0],
    log: memory.docs('notification-logs').at(-1) as Doc,
  }
}

describe('failure classification', () => {
  it('maps HTTP statuses and messages to retryable / permanent / unknown', () => {
    expect(kindForStatus(429)).toBe('retryable')
    expect(kindForStatus(503)).toBe('retryable')
    expect(kindForStatus(504)).toBe('unknown')
    expect(kindForStatus(500)).toBe('unknown')
    expect(kindForStatus(400)).toBe('permanent')
    expect(classifySendFailure(new ProviderError('x', { status: 429 }))).toBe('retryable')
    expect(classifySendFailure(new Error('connect ECONNREFUSED'))).toBe('retryable')
    expect(classifySendFailure(new Error('socket hang up'))).toBe('unknown')
    expect(classifySendFailure(new Error('Request timed out'))).toBe('unknown')
    expect(classifySendFailure(new Error('Invalid "To" phone number'))).toBe('permanent')
  })
})

describe('retry policy', () => {
  const options = normalizePluginOptions({
    reliability: { attempts: 4, maxAttempts: 6, backoff: { delayMs: 1000, maxDelayMs: 5000 } },
  })

  it('layers plugin, trigger and channel policies within the limit', () => {
    expect(resolveRetryPolicy(options, undefined, 'email')).toMatchObject({
      maxAttempts: 4,
      jitter: true,
    })
    expect(
      resolveRetryPolicy(
        options,
        { attempts: 5, channels: { sms: { attempts: 2, jitter: false } } },
        'sms',
      ),
    ).toEqual({
      maxAttempts: 2,
      jitter: false,
      backoff: { type: 'exponential', delayMs: 1000, maxDelayMs: 5000 },
    })
    expect(resolveRetryPolicy(options, { attempts: 50 }, 'email').maxAttempts).toBe(6)
  })

  it('computes exponential and fixed delays with optional jitter', () => {
    const policy = {
      backoff: { type: 'exponential' as const, delayMs: 1000, maxDelayMs: 5000 },
      jitter: false,
    }
    expect([2, 3, 4, 5].map((attempt) => retryDelayMs(policy, attempt))).toEqual([
      1000, 2000, 4000, 5000,
    ])
    expect(retryDelayMs({ ...policy, backoff: { ...policy.backoff, type: 'fixed' } }, 4)).toBe(1000)
    expect(retryDelayMs({ ...policy, jitter: true }, 2, () => 0)).toBe(500)
  })

  it('rejects trigger attempts above the limit', () => {
    expect(() =>
      normalizePluginOptions({
        reliability: { maxAttempts: 3 },
        triggers: [
          {
            slug: 't',
            event: 'a.b',
            reliability: { attempts: 5 },
            deliveries: [{ channel: 'email', template: 'x' }],
          },
        ],
      }),
    ).toThrow('reliability: attempts must be between 1 and 3')
  })
})

describe('provider calls', () => {
  it('times out with an unknown outcome and aborts the signal', async () => {
    let signal: AbortSignal | undefined
    const provider = smsProvider(async (input) => {
      signal = input.signal
      return new Promise(() => undefined)
    })
    const result = await callProvider(
      provider,
      {
        to: 'x',
        channel: 'sms',
        content: { body: '', text: '', html: '' },
        payload: {} as never,
        options: {} as never,
      },
      20,
    )
    expect(result).toMatchObject({
      ok: false,
      kind: 'unknown',
      message: 'Provider did not respond within 20 ms',
    })
    expect(signal?.aborted).toBe(true)
  })
})

describe('delivery sends through providers', () => {
  it('sends via a custom provider and writes an attempt log', async () => {
    const send = mock(async () => ({
      status: 'sent' as const,
      providerMessageId: 'SM1',
      response: { authToken: 'secret', status: 'queued' },
    }))
    const { result, delivery, log } = await run(base(smsProvider(send)))
    expect(result).toMatchObject({ status: 'sent', provider: 'test-sms', providerMessageId: 'SM1' })
    expect((send.mock.calls[0] as unknown as [Doc])[0]).toMatchObject({
      to: '+919876543210',
      content: { body: 'Hi Alex', html: '' },
    })
    expect(delivery).toMatchObject({ status: 'sent', providerMessageId: 'SM1', attempts: 1 })
    expect(log).toMatchObject({
      status: 'sent',
      outcome: 'sent',
      delivery: delivery.id,
      providerResponse: { provider: 'test-sms', messageID: 'SM1' },
    })
    expect(typeof log.durationMs).toBe('number')
    // Provider responses are redacted
    expect((log.providerResponse as Doc).raw).toEqual({ authToken: '[redacted]', status: 'queued' })
    // Rendered content is not stored by default
    expect((log.meta as Doc | undefined)?.rendered).toBeUndefined()
  })

  it('stores rendered content when logs.storeRendered is on', async () => {
    const { log } = await run(
      base(
        smsProvider(async () => ({ status: 'sent' })),
        { logs: { storeRendered: true } },
      ),
    )
    expect((log.meta as Doc).rendered).toMatchObject({ text: 'Hi Alex' })
  })

  it('fails permanently without retrying on 4xx errors', async () => {
    const { result, delivery, log, memory } = await run(
      base(
        smsProvider(async () => {
          throw new ProviderError('Invalid number', { status: 400 })
        }),
      ),
    )
    expect(result).toMatchObject({ status: 'failed', reason: 'Invalid number' })
    expect(delivery).toMatchObject({ status: 'failed', lastError: 'Invalid number' })
    expect(log).toMatchObject({ outcome: 'permanent', failureClassification: 'terminal' })
    expect(memory.queue).toHaveBeenCalledTimes(1)
  })

  it('marks timeouts unknown and never re-sends them', async () => {
    const { result, delivery, log, memory } = await run(
      base(smsProvider(() => new Promise(() => undefined))),
    )
    expect(result?.status).toBe('unknown')
    expect(delivery.status).toBe('unknown')
    expect(log.outcome).toBe('unknown')
    expect(memory.queue).toHaveBeenCalledTimes(1)
  })

  it('fails after the last retryable attempt', async () => {
    const options = base(
      smsProvider(async () => {
        throw new ProviderError('Rate limited', { status: 429 })
      }),
      { reliability: { attempts: 2 } },
    )
    const { memory, delivery } = await run(options)
    expect(delivery).toMatchObject({ status: 'queued', maxAttempts: 2 })
    const retryJob = (memory.queue.mock.calls[1] as unknown as [{ input: Doc }])[0]
    const final = await sendNotification({
      payload: memory.payload,
      input: retryJob.input as never,
      options,
    })
    expect(final?.status).toBe('failed')
    expect(memory.docs('notification-deliveries')[0]).toMatchObject({
      status: 'failed',
      attempts: 2,
    })
    expect(memory.queue).toHaveBeenCalledTimes(2)
  })

  it('treats a delivery found mid-send as unknown instead of sending twice', async () => {
    const send = mock(async () => ({ status: 'sent' as const }))
    const options = base(smsProvider(send))
    const memory = createMemoryPayload({ users })
    await processEvent({
      payload: memory.payload,
      event: { name: 'hello.sent', eventId: 'e1', userId: 'u1' },
      options,
    })
    memory.docs('notification-deliveries')[0].status = 'sending'
    const job = (memory.queue.mock.calls[0] as unknown as [{ input: Doc }])[0]
    const result = await sendNotification({
      payload: memory.payload,
      input: job.input as never,
      options,
    })
    expect(result?.status).toBe('unknown')
    expect(send).toHaveBeenCalledTimes(0)
  })

  it('rejects invalid custom providers', () => {
    expect(() =>
      normalizePluginOptions({ providers: { custom: { sms: { name: 'x' } as never } } }),
    ).toThrow('providers.custom.sms must be a provider with a name and send()')
    expect(() =>
      normalizePluginOptions({
        providers: {
          custom: {
            sms: {
              ...smsProvider(async () => ({ status: 'sent' })),
              channels: ['email'],
              validateConfig: () => ['missing API key'],
            },
          },
        },
      }),
    ).toThrow('provider "test-sms" does not support sms\n  - providers.custom.sms: missing API key')
  })
})
