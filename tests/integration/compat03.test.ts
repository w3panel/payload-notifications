import { afterAll, beforeAll, describe, expect, it, mock } from 'bun:test'
import {
  defineTrigger,
  emitNotificationEvent,
  NOTIFICATIONS_JOB_QUEUE,
  queueNotificationSend,
} from '../../src'
import type { NotificationsPluginOptions } from '../../src/types'
import { createUser, startPayload, testDb, type TestPayload } from './harness'

const TIMEOUT = 60_000

/**
 * 0.3.x configurations must keep working unchanged: rules (no triggers),
 * code-registry templates, user-field preferences and the legacy
 * queueNotificationSend API.
 */
const onDispatch = mock(async () => {})
const legacyOptions: NotificationsPluginOptions = {
  channels: ['email', 'inapp'],
  providers: { email: { defaultFromAddress: 'noreply@example.com' } },
  preferences: { fields: { channels: 'notificationChannels', marketingConsent: 'marketingOptIn' } },
  rules: [
    {
      event: 'order.paid',
      channels: ['email', 'inapp'],
      template: 'order.paid',
      enabled: true,
      condition: async (payload) => Number((payload as { total?: number }).total) > 0,
      templateOverrides: { email: { subject: 'Paid: {{ payload.orderId }}' } },
    },
    defineTrigger({ event: 'newsletter.issued', channels: ['email'], template: 'newsletter' }),
  ],
  templates: {
    registry: {
      'order.paid': {
        email: {
          subject: 'Order {{ payload.orderId }}',
          body: 'Thanks for order {{ payload.orderId }}',
        },
        inapp: { title: 'Order paid', body: 'Order {{ payload.orderId }} is paid' },
      },
      newsletter: { email: { subject: 'News', body: 'Hello' } },
    },
  },
  observability: { onDispatch },
}

describe(`0.3.x configurations (${testDb()})`, () => {
  let t: TestPayload
  let alex: { id: string | number }
  let optedOut: { id: string | number }

  beforeAll(async () => {
    t = await startPayload({
      plugin: legacyOptions,
      collections: [],
    })
    // The 0.3.x preference fields live on the users collection.
    alex = await createUser(t.payload, { email: 'alex@example.com', name: 'Alex' })
    optedOut = await createUser(t.payload, { email: 'quiet@example.com', name: 'Quiet' })
  }, TIMEOUT)

  afterAll(async () => {
    await t?.destroy()
  })

  const emit = (
    name: string,
    userId: string | number,
    payload: Record<string, unknown>,
    extra = {},
  ) =>
    emitNotificationEvent({
      payload: t.payload,
      event: { name, userId: String(userId), payload, ...extra },
    })

  it(
    'runs rules with conditions and template overrides from the code registry',
    async () => {
      t.emails.length = 0
      await emit('order.paid', alex.id, { orderId: 'L-1', total: 20 })
      await emit('order.paid', alex.id, { orderId: 'L-0', total: 0 })
      await t.runJobs()
      expect(t.emails).toEqual([
        expect.objectContaining({ to: 'alex@example.com', subject: 'Paid: L-1' }),
      ])
      const inbox = await t.find('notifications', { recipient: { equals: alex.id } })
      expect(inbox.map((doc) => doc.message)).toEqual(['Order L-1 is paid'])
      expect(onDispatch).toHaveBeenCalled()
    },
    TIMEOUT,
  )

  it(
    'honours user-field channel preferences and marketing consent',
    async () => {
      await t.payload.update({
        collection: 'users' as never,
        id: optedOut.id,
        data: { notificationChannels: { email: false }, marketingOptIn: false } as never,
        overrideAccess: true,
      })
      t.emails.length = 0
      await emit('order.paid', optedOut.id, { orderId: 'Q-1', total: 5 })
      await emit('newsletter.issued', optedOut.id, {}, { classification: 'marketing' })
      await emit('newsletter.issued', alex.id, {}, { classification: 'marketing' })
      await t.runJobs()
      // Email opted out and no marketing consent: only Alex gets the newsletter.
      expect(t.emails.map((email) => `${email.to}:${email.subject}`)).toEqual([
        'alex@example.com:News',
      ])
      const inbox = await t.find('notifications', { recipient: { equals: optedOut.id } })
      expect(inbox.map((doc) => doc.message)).toEqual(['Order Q-1 is paid'])
    },
    TIMEOUT,
  )

  it(
    'sends with the legacy queueNotificationSend API',
    async () => {
      await queueNotificationSend({
        payload: t.payload,
        queue: NOTIFICATIONS_JOB_QUEUE,
        input: {
          userId: String(alex.id),
          channel: 'inapp',
          template: 'order.paid',
          event: 'order.paid',
          eventPayload: { orderId: 'Q-9' },
        },
      })
      await t.runJobs()
      const inbox = await t.find('notifications', { recipient: { equals: alex.id } })
      expect(inbox.map((doc) => doc.message)).toContain('Order Q-9 is paid')
    },
    TIMEOUT,
  )
})
