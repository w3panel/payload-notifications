import { describe, expect, it, mock } from 'bun:test'
import { normalizePluginOptions } from '../src/config/normalizePluginOptions'
import { processEvent } from '../src/jobs/processEvent'
import { sendNotification } from '../src/jobs/sendNotification'
import { ProviderError } from '../src/providers/errors'
import type { NotificationProvider, NotificationsPluginOptions } from '../src/types'
import { createMemoryPayload } from './helpers/memoryPayload'

type Doc = Record<string, unknown>

const sms = (send: NotificationProvider['send']): NotificationProvider => ({
  name: 'sms-test',
  channels: ['sms'],
  capabilities: { html: false, hsm: false, media: false },
  send,
})

const optionsWith = (
  provider: NotificationProvider,
  extra: Partial<NotificationsPluginOptions> = {},
) =>
  normalizePluginOptions({
    channels: ['sms', 'email', 'inapp'],
    providers: { custom: { sms: provider } },
    reliability: { attempts: 1 },
    templates: {
      registry: {
        otp: { sms: 'Code 1234', email: { subject: 'Code', body: 'Code 1234' } },
        'otp.email': { email: { subject: 'Your code', body: 'Email code' } },
      },
    },
    triggers: [
      {
        slug: 'otp',
        event: 'auth.otp',
        deliveries: [
          {
            channel: 'sms',
            template: 'otp',
            fallback: { channel: 'email', template: 'otp.email' },
          },
        ],
      },
    ],
    ...extra,
  })

const runJobs = async (
  memory: ReturnType<typeof createMemoryPayload>,
  options: ReturnType<typeof optionsWith>,
  from = 0,
) => {
  for (let index = from; index < memory.queue.mock.calls.length; index++) {
    const { input } = (memory.queue.mock.calls[index] as unknown as [{ input: Doc }])[0]
    await sendNotification({ payload: memory.payload, input: input as never, options })
  }
}

describe('channel fallback', () => {
  it('falls back to email after a permanent SMS failure', async () => {
    const memory = createMemoryPayload({
      users: [{ id: 'u1', email: 'u1@example.com', phone: '+919876543210' }],
    })
    const options = optionsWith(
      sms(async () => {
        throw new ProviderError('Unreachable handset', { status: 400 })
      }),
    )
    await processEvent({
      payload: memory.payload,
      event: { name: 'auth.otp', eventId: 'e1', userId: 'u1' },
      options,
    })
    await runJobs(memory, options)

    const [primary, fallback] = memory.docs('notification-deliveries')
    expect(primary).toMatchObject({ channel: 'sms', status: 'failed' })
    expect(fallback).toMatchObject({
      channel: 'email',
      templateSlug: 'otp.email',
      status: 'sent',
      fallbackOf: primary.id,
      destination: 'u1@example.com',
      idempotencyKey: `${primary.idempotencyKey}::fallback:email`,
    })
    expect((memory.sendEmail.mock.calls[0][0] as unknown as Doc).subject).toBe('Your code')
  })

  it('falls back immediately when the recipient has no phone', async () => {
    const memory = createMemoryPayload({ users: [{ id: 'u1', email: 'u1@example.com' }] })
    const options = optionsWith(sms(async () => ({ status: 'sent' })))
    await processEvent({
      payload: memory.payload,
      event: { name: 'auth.otp', eventId: 'e1', userId: 'u1' },
      options,
    })
    expect(memory.docs('notification-deliveries').map((d) => [d.channel, d.status])).toEqual([
      ['sms', 'skipped'],
      ['email', 'queued'],
    ])
  })

  it('falls back when policy blocks the channel', async () => {
    const memory = createMemoryPayload({
      users: [
        {
          id: 'u1',
          email: 'u1@example.com',
          phone: '+919876543210',
          notificationPreferences: { channels: { sms: false } },
        },
      ],
    })
    const send = mock(async () => ({ status: 'sent' as const }))
    const options = optionsWith(sms(send))
    await processEvent({
      payload: memory.payload,
      event: { name: 'auth.otp', eventId: 'e1', userId: 'u1' },
      options,
    })
    await runJobs(memory, options)
    expect(send).toHaveBeenCalledTimes(0)
    expect(memory.docs('notification-deliveries').map((d) => [d.channel, d.status])).toEqual([
      ['sms', 'skipped'],
      ['email', 'sent'],
    ])
  })

  it('never falls back on unknown outcomes or when the reason is not listed', async () => {
    const memory = createMemoryPayload({
      users: [{ id: 'u1', email: 'u1@example.com', phone: '+919876543210' }],
    })
    const options = optionsWith(
      sms(() => new Promise(() => undefined)),
      { providers: { custom: { sms: sms(() => new Promise(() => undefined)) }, timeoutMs: 100 } },
    )
    await processEvent({
      payload: memory.payload,
      event: { name: 'auth.otp', eventId: 'e1', userId: 'u1' },
      options,
    })
    await runJobs(memory, options)
    expect(memory.docs('notification-deliveries').map((d) => d.status)).toEqual(['unknown'])

    const policyOnly = optionsWith(
      sms(async () => {
        throw new ProviderError('bad', { status: 400 })
      }),
    )
    policyOnly.triggers[0].deliveries[0].fallback = { channel: 'email', on: ['policy'] }
    const second = createMemoryPayload({
      users: [{ id: 'u1', email: 'u1@example.com', phone: '+919876543210' }],
    })
    await processEvent({
      payload: second.payload,
      event: { name: 'auth.otp', eventId: 'e1', userId: 'u1' },
      options: policyOnly,
    })
    await runJobs(second, policyOnly)
    expect(second.docs('notification-deliveries')).toHaveLength(1)
  })

  it('validates fallback definitions', () => {
    const invalid = (fallback: unknown) =>
      normalizePluginOptions({
        channels: ['email', 'inapp'],
        triggers: [
          {
            slug: 't',
            event: 'a.b',
            recipients: [{ type: 'static', email: 'ops@example.com', alias: 'ops' }],
            deliveries: [{ channel: 'email', template: 'x', recipient: 'ops', fallback } as never],
          },
        ],
      })
    expect(() => invalid({ channel: 'email' })).toThrow('must use a different channel')
    expect(() => invalid({ channel: 'sms' })).toThrow('channel "sms" is not enabled')
    expect(() => invalid({ channel: 'inapp' })).toThrow(
      'static recipient "ops" has no in-app destination',
    )
    expect(() => invalid({ channel: 'inapp', on: ['always'] })).toThrow('on must list permanent')
  })
})
