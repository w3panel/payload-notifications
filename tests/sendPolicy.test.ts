import { describe, expect, it, mock } from 'bun:test'
import { sendNotification } from '../src/jobs/sendNotification'
import { normalizePluginOptions } from '../src/config/normalizePluginOptions'

describe('sendNotification preference and policy controls', () => {
  it('logs and skips when the user opted out of a channel', async () => {
    const create = mock(async () => undefined)
    const payload = {
      create,
      findByID: mock(async () => ({
        id: 'user_1',
        notificationPreferences: {
          channels: {
            email: false,
          },
        },
      })),
    }

    const result = await sendNotification({
      payload: payload as never,
      input: {
        userId: 'user_1',
        channel: 'email',
        template: 'order-paid',
        event: 'order.paid',
        classification: 'transactional',
      },
      options: normalizePluginOptions(),
    })

    expect(result?.status).toBe('skipped')
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('logs and skips marketing notifications without consent', async () => {
    const create = mock(async () => undefined)
    const payload = {
      create,
      findByID: mock(async () => ({
        id: 'user_1',
        notificationPreferences: {
          marketing: false,
        },
      })),
    }

    const result = await sendNotification({
      payload: payload as never,
      input: {
        userId: 'user_1',
        channel: 'email',
        template: 'promo',
        event: 'campaign.launch',
        classification: 'marketing',
      },
      options: normalizePluginOptions(),
    })

    expect(result?.status).toBe('skipped')
    expect(result?.reason).toContain('not consented')
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('enforces marketing consent for classification queued through processEvent', async () => {
    const { processEvent } = await import('../src/jobs/processEvent')
    const queue = mock(async () => undefined)
    const create = mock(async () => undefined)

    await processEvent({
      payload: { jobs: { queue }, create } as never,
      event: {
        name: 'campaign.launch',
        userId: 'user_1',
        classification: 'marketing',
      },
      options: normalizePluginOptions({
        channels: ['email'],
        rules: [
          {
            event: 'campaign.launch',
            channels: ['email'],
            template: 'campaign.launch',
          },
        ],
      }),
    })

    expect(queue.mock.calls[0]?.[0]?.input?.classification).toBe('marketing')

    const result = await sendNotification({
      payload: {
        create,
        findByID: mock(async () => ({
          id: 'user_1',
          notificationPreferences: { marketing: false },
        })),
      } as never,
      input: queue.mock.calls[0]?.[0]?.input,
      options: normalizePluginOptions(),
    })

    expect(result?.status).toBe('skipped')
    expect(result?.reason).toContain('not consented')
  })

  it('logs and skips when custom policy denies delivery', async () => {
    const create = mock(async () => undefined)
    const payload = {
      create,
      findByID: mock(async () => ({
        id: 'user_1',
        plan: 'free',
      })),
    }

    const result = await sendNotification({
      payload: payload as never,
      input: {
        userId: 'user_1',
        channel: 'sms',
        template: 'promo',
        event: 'campaign.launch',
        classification: 'marketing',
      },
      options: normalizePluginOptions({
        policy: {
          canSend: ({ user, channel }) => ({
            allow: !(user.plan === 'free' && channel === 'sms'),
            reason: 'SMS disabled for free plan',
          }),
        },
      }),
    })

    expect(result?.status).toBe('skipped')
    expect(result?.reason).toBe('SMS disabled for free plan')
    expect(create).toHaveBeenCalledTimes(1)
  })
})
