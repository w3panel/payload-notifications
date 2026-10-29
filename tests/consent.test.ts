import { describe, expect, it } from 'bun:test'
import { normalizePluginOptions } from '../src/config/normalizePluginOptions'
import { unsubscribeEndpoints } from '../src/endpoints/unsubscribe'
import { processEvent } from '../src/jobs/processEvent'
import { sendNotification } from '../src/jobs/sendNotification'
import { registerCollections } from '../src/plugin'
import { pickPreference } from '../src/policy/deliveryPolicy'
import { recordSuppression } from '../src/policy/suppressions'
import { signUnsubscribeToken, verifyUnsubscribeToken } from '../src/policy/unsubscribe'
import type { NotificationsPluginOptions } from '../src/types'
import { createMemoryPayload } from './helpers/memoryPayload'

type Doc = Record<string, unknown>
const SECRET = 'a-very-long-unsubscribe-secret'

const users = [{ id: 'u1', name: 'Alex', email: 'Alex@Example.com', phone: '+919876543210' }]

const optionsWith = (extra: Partial<NotificationsPluginOptions> = {}, trigger: Doc = {}) =>
  normalizePluginOptions({
    channels: ['email'],
    preferences: {
      mode: 'collection',
      unsubscribe: { secret: SECRET, baseUrl: 'https://shop.example.com' },
    },
    templates: {
      registry: {
        promo: { email: { subject: 'Sale', body: 'Big sale. Unsubscribe: {{ unsubscribeUrl }}' } },
        receipt: { email: { subject: 'Receipt', body: 'Thanks {{ unsubscribeUrl }}' } },
      },
    },
    triggers: [
      {
        slug: 'promo',
        event: 'promo.sent',
        classification: 'marketing',
        category: 'newsletter',
        deliveries: [{ channel: 'email', template: 'promo' }],
        ...trigger,
      } as never,
      {
        slug: 'receipt',
        event: 'order.paid',
        deliveries: [{ channel: 'email', template: 'receipt' }],
      },
    ],
    ...extra,
  })

const send = async (
  options: ReturnType<typeof optionsWith>,
  memory: ReturnType<typeof createMemoryPayload>,
  event = 'promo.sent',
) => {
  const before = memory.queue.mock.calls.length
  await processEvent({
    payload: memory.payload,
    event: { name: event, eventId: `e${before}`, userId: 'u1' },
    options,
  })
  const job = (memory.queue.mock.calls[before] as unknown as [{ input: Doc }])[0]
  return sendNotification({ payload: memory.payload, input: job.input as never, options })
}

describe('consent options and collections', () => {
  it('validates preference mode and unsubscribe settings', () => {
    expect(normalizePluginOptions().preferences).toMatchObject({
      mode: 'userFields',
      mandatoryCategories: ['transactional'],
    })
    expect(() => normalizePluginOptions({ preferences: { mode: 'db' as never } })).toThrow(
      'preferences.mode must be',
    )
    expect(() =>
      normalizePluginOptions({
        preferences: { mode: 'collection', unsubscribe: { secret: 'short' } },
      }),
    ).toThrow('at least 16 characters')
    expect(() =>
      normalizePluginOptions({ preferences: { unsubscribe: { secret: SECRET } } }),
    ).toThrow("needs preferences.mode: 'collection'")
  })

  it('registers preferences only in collection mode, with own-record access', async () => {
    expect(registerCollections([], normalizePluginOptions()).map((c) => c.slug)).not.toContain(
      'notification-preferences',
    )
    const collections = registerCollections([], optionsWith())
    const preferences = collections.find((c) => c.slug === 'notification-preferences')!
    const access = preferences.access as Record<string, (args: unknown) => Promise<unknown>>
    expect(await access.read({ req: { user: { id: 'u1' } } })).toBe(true) // default isAdmin: logged in
    const restricted = registerCollections([], optionsWith({ access: { isAdmin: () => false } }))
    const own = restricted.find((c) => c.slug === 'notification-preferences')!.access as Record<
      string,
      (args: unknown) => Promise<unknown>
    >
    expect(await own.update({ req: { user: { id: 'u1' } } })).toEqual({ user: { equals: 'u1' } })
    expect(await own.read({ req: { user: null } })).toBe(false)
  })
})

describe('suppressions', () => {
  it('records normalized destinations once and blocks sends to them', async () => {
    const memory = createMemoryPayload({ users })
    const options = optionsWith()
    expect(
      await recordSuppression({
        payload: memory.payload,
        options,
        channel: 'email',
        destination: ' ALEX@example.com ',
        reason: 'bounce',
      }),
    ).toBe(true)
    expect(
      await recordSuppression({
        payload: memory.payload,
        options,
        channel: 'email',
        destination: 'alex@example.com',
        reason: 'bounce',
      }),
    ).toBe(false)
    expect(memory.docs('notification-suppressions')).toEqual([
      expect.objectContaining({
        destination: 'alex@example.com',
        channel: 'email',
        reason: 'bounce',
      }),
    ])

    // Suppression applies even to mandatory transactional deliveries
    const result = await send(options, memory, 'order.paid')
    expect(result).toMatchObject({
      status: 'skipped',
      reason: 'Destination is suppressed (bounce)',
    })
    expect(memory.sendEmail).toHaveBeenCalledTimes(0)
  })
})

describe('preferences (collection mode)', () => {
  it('picks the most specific preference', () => {
    const docs = [
      { category: '*', channel: '*', enabled: true },
      { category: 'newsletter', channel: '*', enabled: false },
      { category: 'newsletter', channel: 'email', enabled: true },
      { category: '*', channel: 'sms', enabled: false },
    ]
    expect(pickPreference(docs, 'newsletter', 'email')).toEqual(docs[2])
    expect(pickPreference(docs, 'newsletter', 'sms')).toEqual(docs[1])
    expect(pickPreference(docs, 'orders', 'sms')).toEqual(docs[3])
    expect(pickPreference(docs, 'orders', 'email')).toEqual(docs[0])
  })

  it('honours category opt-outs but not for mandatory transactional deliveries', async () => {
    const memory = createMemoryPayload({
      users,
      'notification-preferences': [
        { user: 'u1', category: 'newsletter', channel: '*', enabled: false },
        { user: 'u1', category: '*', channel: 'email', enabled: false },
      ],
    })
    const options = optionsWith()
    expect(await send(options, memory)).toMatchObject({
      status: 'skipped',
      reason: 'User opted out of newsletter via email',
    })
    expect(await send(options, memory, 'order.paid')).toMatchObject({ status: 'sent' })
  })

  it('requires an explicit marketing opt-in when configured', async () => {
    const memory = createMemoryPayload({ users })
    const options = optionsWith({
      preferences: { mode: 'collection', marketingRequiresOptIn: true },
    })
    expect(await send(options, memory)).toMatchObject({
      reason: 'User has not opted in to marketing notifications',
    })
    memory.db['notification-preferences'] = [
      { user: 'u1', category: 'newsletter', channel: 'email', enabled: true },
    ]
    expect(await send(options, memory)).toMatchObject({ status: 'sent' })
  })
})

describe('unsubscribe', () => {
  it('signs and verifies tokens and rejects tampering', async () => {
    const token = await signUnsubscribeToken(SECRET, { u: 'u1', c: 'newsletter' })
    expect(await verifyUnsubscribeToken(SECRET, token)).toEqual({ u: 'u1', c: 'newsletter' })
    expect(await verifyUnsubscribeToken('another-secret-of-length', token)).toBeUndefined()
    const [body, signature] = token.split('.')
    expect(await verifyUnsubscribeToken(SECRET, `${body}x.${signature}`)).toBeUndefined()
    expect(await verifyUnsubscribeToken(SECRET, 'garbage')).toBeUndefined()
  })

  it('adds a link and one-click headers to opt-out-able email, then records the opt-out', async () => {
    const memory = createMemoryPayload({ users })
    const options = optionsWith()
    await send(options, memory)
    const email = memory.sendEmail.mock.calls[0][0] as unknown as {
      text: string
      headers: Record<string, string>
    }
    const url = email.text.split('Unsubscribe: ')[1]
    expect(url).toStartWith('https://shop.example.com/api/payload-notifications/unsubscribe?token=')
    expect(email.headers).toEqual({
      'List-Unsubscribe': `<${url}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    })

    // Mandatory transactional email gets neither
    await send(options, memory, 'order.paid')
    const receipt = memory.sendEmail.mock.calls[1][0] as unknown as {
      text: string
      headers?: unknown
    }
    expect(receipt.text).toBe('Thanks ')
    expect(receipt.headers).toBeUndefined()

    const [getEndpoint, postEndpoint] = unsubscribeEndpoints(() => options)
    const page = await getEndpoint.handler({ url, method: 'GET', payload: memory.payload } as never)
    expect(await page.text()).toContain('Stop receiving <strong>newsletter</strong>')

    const done = await postEndpoint.handler({
      url,
      method: 'POST',
      payload: memory.payload,
      text: async () => '',
    } as never)
    expect(done.status).toBe(200)
    expect(memory.docs('notification-preferences')).toEqual([
      expect.objectContaining({
        user: 'u1',
        category: 'newsletter',
        channel: '*',
        enabled: false,
        consentSource: 'unsubscribe-link',
      }),
    ])
    expect(await send(options, memory)).toMatchObject({ status: 'skipped' })

    const bad = await getEndpoint.handler({
      url: `${url}x`,
      method: 'GET',
      payload: memory.payload,
    } as never)
    expect(bad.status).toBe(400)
  })
})
