import { describe, expect, it } from 'bun:test'
import { normalizePluginOptions } from '../src/config/normalizePluginOptions'
import { pruneNotifications, reconcileDeliveries } from '../src/jobs/maintenance'
import type { NotificationProvider } from '../src/types'
import { webhookEndpoints } from '../src/webhooks/endpoints'
import { metaSignature, twilioSignature } from '../src/webhooks/signatures'
import { createMemoryPayload } from './helpers/memoryPayload'

type Doc = Record<string, unknown>
const TOKEN = 'twilio-auth-token'
const APP_SECRET = 'meta-app-secret'

const options = normalizePluginOptions({
  channels: ['sms', 'whatsapp', 'email'],
  providers: {
    sms: { provider: 'twilio', accountSid: 'AC1', authToken: TOKEN, from: '+15550000000' },
    whatsapp: { provider: 'meta', accessToken: 'x', phoneNumberId: '1' },
  },
  webhooks: {
    publicUrl: 'https://shop.example.com',
    meta: { appSecret: APP_SECRET, verifyToken: 'verify-me' },
  },
})

const [twilioEndpoint, metaGet, metaPost, customGet] = webhookEndpoints(() => options)

const deliveries = () => [
  {
    id: 'd1',
    channel: 'sms',
    status: 'sent',
    providerMessageId: 'SM1',
    destination: '+919876543210',
    idempotencyKey: 'k1',
  },
  {
    id: 'd2',
    channel: 'sms',
    status: 'sent',
    providerMessageId: 'SM2',
    destination: '+919876543211',
    idempotencyKey: 'k2',
    fallback: { channel: 'email' },
    recipientDestinations: { email: 'u@example.com' },
    event: 'e',
    trigger: 't',
    templateSlug: 'x',
  },
  {
    id: 'd3',
    channel: 'whatsapp',
    status: 'unknown',
    providerMessageId: 'wamid.1',
    destination: '+919876543212',
    idempotencyKey: 'k3',
  },
]

const twilioRequest = async (
  memory: ReturnType<typeof createMemoryPayload>,
  params: Record<string, string>,
  signed = true,
) => {
  const body = new URLSearchParams(params)
  const url = 'https://shop.example.com/api/payload-notifications/webhooks/twilio'
  const headers = new Headers({ 'content-type': 'application/x-www-form-urlencoded' })
  if (signed) headers.set('x-twilio-signature', await twilioSignature(TOKEN, url, body))
  return twilioEndpoint.handler({
    // The server sees an internal URL; publicUrl makes the signature match.
    url: 'http://internal:3000/api/payload-notifications/webhooks/twilio',
    method: 'POST',
    headers,
    text: async () => body.toString(),
    payload: memory.payload,
  } as never)
}

describe('Twilio webhooks', () => {
  it('rejects unsigned or tampered requests', async () => {
    const memory = createMemoryPayload({ 'notification-deliveries': deliveries() })
    expect(
      (await twilioRequest(memory, { MessageSid: 'SM1', MessageStatus: 'delivered' }, false))
        .status,
    ).toBe(403)
  })

  it('marks deliveries delivered and failed, suppressing invalid numbers and falling back', async () => {
    const memory = createMemoryPayload({ 'notification-deliveries': deliveries() })
    const delivered = await twilioRequest(memory, { MessageSid: 'SM1', MessageStatus: 'delivered' })
    expect(await delivered.json()).toEqual({ ok: true, updated: 1, suppressed: 0, unmatched: 0 })
    expect(memory.docs('notification-deliveries')[0]).toMatchObject({ status: 'delivered' })
    expect(memory.docs('notification-deliveries')[0].deliveredAt).toBeString()

    await twilioRequest(memory, {
      MessageSid: 'SM2',
      MessageStatus: 'undelivered',
      ErrorCode: '21211',
    })
    const [, failed, , fallback] = memory.docs('notification-deliveries')
    expect(failed).toMatchObject({ status: 'failed', lastError: 'Twilio error 21211' })
    expect(memory.docs('notification-suppressions')).toEqual([
      expect.objectContaining({ destination: '+919876543211', channel: 'sms', reason: 'invalid' }),
    ])
    expect(fallback).toMatchObject({
      channel: 'email',
      fallbackOf: 'd2',
      destination: 'u@example.com',
    })

    const unmatched = await twilioRequest(memory, {
      MessageSid: 'SM404',
      MessageStatus: 'delivered',
    })
    expect((await unmatched.json()).unmatched).toBe(1)
  })

  it('records STOP replies and lifts them on START', async () => {
    const memory = createMemoryPayload()
    await twilioRequest(memory, {
      From: '+919876543210',
      Body: 'STOP',
      OptOutType: 'STOP',
      MessageSid: 'SMin',
    })
    expect(memory.docs('notification-suppressions')).toEqual([
      expect.objectContaining({ destination: '+919876543210', channel: 'sms', reason: 'stop' }),
    ])
    await twilioRequest(memory, { From: '+919876543210', Body: 'start', MessageSid: 'SMin2' })
    expect(memory.docs('notification-suppressions')).toEqual([])
  })
})

describe('Meta webhooks', () => {
  const metaRequest = async (
    memory: ReturnType<typeof createMemoryPayload>,
    body: unknown,
    secret = APP_SECRET,
  ) => {
    const raw = JSON.stringify(body)
    return metaPost.handler({
      url: 'http://internal/api/payload-notifications/webhooks/meta',
      method: 'POST',
      headers: new Headers({ 'x-hub-signature-256': await metaSignature(secret, raw) }),
      text: async () => raw,
      payload: memory.payload,
    } as never)
  }

  it('answers the verification handshake', async () => {
    const memory = createMemoryPayload()
    const ok = await metaGet.handler({
      url: 'http://internal/api/payload-notifications/webhooks/meta?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=42',
      method: 'GET',
      headers: new Headers(),
      payload: memory.payload,
    } as never)
    expect(ok.status).toBe(200)
    expect(await ok.text()).toBe('42')
    const bad = await metaGet.handler({
      url: 'http://internal/api/payload-notifications/webhooks/meta?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=42',
      method: 'GET',
      headers: new Headers(),
      payload: memory.payload,
    } as never)
    expect(bad.status).toBe(403)
  })

  it('resolves unknown sends, records reads and STOP replies', async () => {
    const memory = createMemoryPayload({ 'notification-deliveries': deliveries() })
    const response = await metaRequest(memory, {
      entry: [
        {
          changes: [
            {
              value: {
                statuses: [{ id: 'wamid.1', status: 'read' }],
                messages: [{ from: '919000000000', type: 'text', text: { body: 'Stop' } }],
              },
            },
          ],
        },
      ],
    })
    expect(await response.json()).toEqual({ ok: true, updated: 1, suppressed: 1, unmatched: 0 })
    expect(memory.docs('notification-deliveries')[2]).toMatchObject({ status: 'delivered' })
    expect(memory.docs('notification-deliveries')[2].readAt).toBeString()
    expect(memory.docs('notification-suppressions')[0]).toMatchObject({
      destination: '+919000000000',
      channel: 'whatsapp',
    })

    expect((await metaRequest(memory, { entry: [] }, 'wrong-secret')).status).toBe(403)
  })
})

describe('custom provider webhooks', () => {
  it('routes to the provider parseWebhook', async () => {
    const provider: NotificationProvider = {
      name: 'custom-sms',
      channels: ['sms'],
      capabilities: { html: false, hsm: false, media: false },
      send: async () => ({ status: 'sent' }),
      parseWebhook: async () => ({
        verified: true,
        updates: [{ providerMessageId: 'SM1', status: 'delivered' }],
        inbound: [],
      }),
    }
    const custom = normalizePluginOptions({
      channels: ['sms'],
      providers: { custom: { sms: provider } },
    })
    const [, , , , customPost] = webhookEndpoints(() => custom)
    const memory = createMemoryPayload({ 'notification-deliveries': deliveries() })
    const res = await customPost.handler({
      url: 'http://internal/api/payload-notifications/webhooks/provider/sms',
      method: 'POST',
      headers: new Headers(),
      text: async () => '',
      routeParams: { channel: 'sms' },
      payload: memory.payload,
    } as never)
    expect((await res.json()).updated).toBe(1)
    const missing = await customGet.handler({
      url: 'http://internal/x',
      method: 'GET',
      headers: new Headers(),
      routeParams: { channel: 'email' },
      payload: memory.payload,
    } as never)
    expect(missing.status).toBe(404)
  })
})

describe('maintenance tasks', () => {
  it('marks stale sending deliveries unknown and resolves unknown ones via getStatus', async () => {
    const getStatus = async (id: string) => ({
      providerMessageId: id,
      status: 'delivered' as const,
    })
    const withStatus = normalizePluginOptions({
      channels: ['sms'],
      reliability: { staleSendingMinutes: 10 },
      providers: {
        custom: {
          sms: {
            name: 's',
            channels: ['sms'],
            capabilities: { html: false, hsm: false, media: false },
            send: async () => ({ status: 'sent' }),
            getStatus,
          },
        },
      },
    })
    const now = new Date('2026-10-29T12:00:00.000Z')
    const memory = createMemoryPayload({
      'notification-deliveries': [
        { id: 'stale', channel: 'sms', status: 'sending', updatedAt: '2026-10-29T11:00:00.000Z' },
        { id: 'fresh', channel: 'sms', status: 'sending', updatedAt: '2026-10-29T11:55:00.000Z' },
        { id: 'unknown', channel: 'sms', status: 'unknown', providerMessageId: 'SMx' },
      ],
    })
    expect(await reconcileDeliveries(memory.payload, withStatus, now)).toEqual({
      staleMarkedUnknown: 1,
      reconciled: 1,
    })
    expect(memory.docs('notification-deliveries').map((d) => d.status)).toEqual([
      'unknown',
      'sending',
      'delivered',
    ])
  })

  it('prunes old records per retention settings', async () => {
    const now = new Date('2026-10-29T00:00:00.000Z')
    const retention = normalizePluginOptions({
      maintenance: { retention: { logsDays: 30, deliveriesDays: 90 } },
    })
    const memory = createMemoryPayload({
      'notification-logs': [
        { id: 'l-old', createdAt: '2026-08-01T00:00:00.000Z' },
        { id: 'l-new', createdAt: '2026-10-20T00:00:00.000Z' },
      ],
      'notification-deliveries': [
        { id: 'd-old-sent', status: 'sent', createdAt: '2026-01-01T00:00:00.000Z' },
        { id: 'd-old-queued', status: 'queued', createdAt: '2026-01-01T00:00:00.000Z' },
      ],
    })
    expect(await pruneNotifications(memory.payload, retention, now)).toEqual({
      logs: 1,
      deliveries: 1,
      events: 0,
    })
    expect(memory.docs('notification-deliveries').map((d: Doc) => d.id)).toEqual(['d-old-queued'])
    expect(() => normalizePluginOptions({ maintenance: { retention: { logsDays: 0 } } })).toThrow(
      'positive number of days',
    )
  })
})
