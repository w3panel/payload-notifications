import { afterEach, describe, expect, it, mock } from 'bun:test'
import { normalizePluginOptions } from '../src/config/normalizePluginOptions'
import { processEvent } from '../src/jobs/processEvent'
import { sendNotification } from '../src/jobs/sendNotification'
import {
  finalizeForChannel,
  findUnsafeLinks,
  sanitizeLinks,
  smsSegments,
} from '../src/templates/channelContent'
import { renderDefinition } from '../src/templates/renderDefinition'
import { validateTemplateDoc } from '../src/templates/validate'
import { whatsappStatusEndpoint } from '../src/templates/whatsappStatus'
import type { NotificationsPluginOptions } from '../src/types'
import { createMemoryPayload } from './helpers/memoryPayload'

type Doc = Record<string, unknown>
const originalFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('SMS segments', () => {
  it('counts GSM-7 and UCS-2 segments', () => {
    expect(smsSegments('a'.repeat(160))).toEqual({
      encoding: 'GSM-7',
      characters: 160,
      segments: 1,
    })
    expect(smsSegments('a'.repeat(161))).toEqual({
      encoding: 'GSM-7',
      characters: 161,
      segments: 2,
    })
    expect(smsSegments('€'.repeat(80))).toEqual({ encoding: 'GSM-7', characters: 160, segments: 1 })
    expect(smsSegments('नमस्ते'.repeat(12))).toMatchObject({ encoding: 'UCS-2', segments: 2 })
    expect(smsSegments('🙂'.repeat(35))).toMatchObject({
      encoding: 'UCS-2',
      characters: 70,
      segments: 1,
    })
  })
})

describe('email links, preheader and layout', () => {
  it('finds and neutralizes unsafe links', () => {
    const html =
      '<a href="https://ok.example">ok</a><a href=\'javascript:alert(1)\'>x</a><img src="data:image/png;base64,AA"><a href="{{ payload.url }}">t</a><a href="mailto:a@b.co">m</a>'
    expect(findUnsafeLinks(html)).toEqual(['javascript:alert(1)', 'data:image/png;base64,AA'])
    expect(sanitizeLinks(html)).toContain("href='#'")
    expect(sanitizeLinks(html)).toContain('src="#"')
    expect(sanitizeLinks(html)).toContain('href="https://ok.example"')
  })

  it('wraps email in a layout and adds the preheader', async () => {
    const rendered = renderDefinition(
      {
        subject: 'Order {{ payload.id }}',
        body: 'x',
        htmlBody: '<p>Hi</p>',
        preheader: 'Your order {{ payload.id }} shipped',
      },
      { event: 'e', userId: 'u', payload: { id: '42' } },
    )
    expect(rendered.preheader).toBe('Your order 42 shipped')

    const withLayout = await finalizeForChannel(rendered, 'email', {
      templates: {
        emailLayout: '<html><body class="x"><h1>{{ subject }}</h1>{{{ content }}}</body></html>',
      },
    } as never)
    expect(withLayout.html).toBe(
      '<html><body class="x"><div style="display:none;max-height:0;overflow:hidden;mso-hide:all">Your order 42 shipped</div><h1>Order 42</h1><p>Hi</p></body></html>',
    )

    const fnLayout = await finalizeForChannel(rendered, 'email', {
      templates: { emailLayout: ({ html }: { html: string }) => `<main>${html}</main>` },
    } as never)
    expect(fnLayout.html).toStartWith('<div style="display:none')
    expect(fnLayout.html).toEndWith('<main><p>Hi</p></main>')
  })

  it('shortens links and counts segments for SMS', async () => {
    const rendered = renderDefinition(
      { body: 'Track https://shop.example.com/orders/42?x=1 now' },
      { event: 'e', userId: 'u' },
    )
    const finished = await finalizeForChannel(rendered, 'sms', {
      templates: { shortenLink: async (url: string) => `https://sho.rt/${url.length}` },
    } as never)
    expect(finished.body).toBe('Track https://sho.rt/38 now')
    expect(finished.segments).toEqual({ encoding: 'GSM-7', characters: 27, segments: 1 })
  })
})

const users = [{ id: 'u1', name: 'Alex', email: 'a@example.com', phone: '+919876543210' }]

const deliveryOptions = (extra: Partial<NotificationsPluginOptions> = {}) =>
  normalizePluginOptions({
    channels: ['inapp', 'whatsapp'],
    providers: {
      whatsapp: {
        provider: 'meta',
        accessToken: 'token',
        phoneNumberId: '123',
        businessAccountId: 'waba',
      },
    },
    triggers: [
      {
        slug: 'shipped',
        event: 'order.shipped',
        deliveries: [
          { channel: 'inapp', template: 'order.shipped' },
          { channel: 'whatsapp', template: 'order.shipped' },
        ],
      },
    ],
    ...extra,
  })

const template = (status?: string) => ({
  id: 't1',
  slug: 'order.shipped',
  status: 'active',
  version: 1,
  channels: ['inapp', 'whatsapp'],
  inapp: {
    title: 'Shipped',
    body: 'Order {{ payload.orderId }}',
    actionUrl: '/orders/{{ payload.orderId }}',
    icon: 'truck',
    priority: 'high',
  },
  whatsapp: {
    body: 'fallback text',
    hsmTemplateId: 'order_shipped',
    hsmLanguage: 'en_US',
    hsmParameters: [{ value: '{{ recipient.name }}' }, { value: '{{ payload.orderId }}' }],
  },
  ...(status ? { whatsappTemplateStatus: status } : {}),
})

const runAll = async (
  memory: ReturnType<typeof createMemoryPayload>,
  options: ReturnType<typeof deliveryOptions>,
) => {
  await processEvent({
    payload: memory.payload,
    event: { name: 'order.shipped', eventId: 'e1', userId: 'u1', payload: { orderId: 'O42' } },
    options,
  })
  const results = []
  for (const call of memory.queue.mock.calls) {
    const { input } = (call as unknown as [{ input: Doc }])[0]
    results.push(
      await sendNotification({ payload: memory.payload, input: input as never, options }),
    )
  }
  return results
}

describe('channel-native deliveries', () => {
  it('stores in-app action URL, icon and priority, and sends approved WhatsApp templates', async () => {
    const fetchMock = mock(async (_url: string, _init: { body: string }) => ({
      ok: true,
      status: 200,
      json: async () => ({ messaging_product: 'whatsapp', messages: [{ id: 'wamid.9' }] }),
    }))
    globalThis.fetch = fetchMock as unknown as typeof fetch
    const memory = createMemoryPayload({ users, 'notification-templates': [template('APPROVED')] })
    const results = await runAll(memory, deliveryOptions())

    expect(results.map((result) => result?.status)).toEqual(['stored', 'sent'])
    expect(memory.docs('notifications')[0]).toMatchObject({
      title: 'Shipped',
      message: 'Order O42',
      icon: 'truck',
      priority: 'high',
      meta: { link: '/orders/O42' },
    })
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '+919876543210',
      type: 'template',
      template: {
        name: 'order_shipped',
        language: { code: 'en_US' },
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: 'Alex' },
              { type: 'text', text: 'O42' },
            ],
          },
        ],
      },
    })
  })

  it('fails fast when the WhatsApp template is not approved', async () => {
    const fetchMock = mock(async () => ({ ok: true, status: 200, json: async () => ({}) }))
    globalThis.fetch = fetchMock as unknown as typeof fetch
    const memory = createMemoryPayload({ users, 'notification-templates': [template('REJECTED')] })
    const results = await runAll(memory, deliveryOptions())
    expect(results[1]).toMatchObject({
      status: 'failed',
      reason: 'WhatsApp template "order_shipped" is REJECTED',
    })
    expect(fetchMock).toHaveBeenCalledTimes(0)
  })
})

describe('template checks and status sync', () => {
  const options = deliveryOptions()

  it('blocks unsafe links and warns about long SMS and unapproved templates', async () => {
    const report = await validateTemplateDoc(createMemoryPayload().payload, options, {
      slug: 'promo',
      channels: ['email', 'sms', 'whatsapp'],
      email: { subject: 's', htmlBody: '<a href="javascript:void(0)">x</a>' },
      sms: { body: 'x'.repeat(500) },
      whatsappTemplateStatus: 'PENDING',
    })
    expect(report.errors).toEqual([
      'email: link "javascript:void(0)" uses an unsafe scheme (allowed: http, https, mailto, tel)',
    ])
    expect(report.warnings).toEqual([
      'sms: about 4 GSM-7 segments before variables are filled in',
      'whatsapp: template is PENDING; WhatsApp sends will fail until it is approved',
    ])
  })

  it('syncs the approval status from Meta', async () => {
    const fetchMock = mock(async (_url: string) => ({
      ok: true,
      status: 200,
      json: async () => ({
        data: [
          { name: 'order_shipped', status: 'PENDING', language: 'hi' },
          { name: 'order_shipped', status: 'APPROVED', language: 'en_US' },
        ],
      }),
    }))
    globalThis.fetch = fetchMock as unknown as typeof fetch
    const memory = createMemoryPayload({ 'notification-templates': [template()] })
    const res = await whatsappStatusEndpoint(() => options).handler({
      user: { id: 'a' },
      routeParams: { id: 't1' },
      payload: memory.payload,
    } as never)
    expect(await res.json()).toEqual({ ok: true, status: 'APPROVED' })
    expect(fetchMock.mock.calls[0][0]).toContain('/waba/message_templates?name=order_shipped')
    expect(memory.docs('notification-templates')[0].whatsappTemplateStatus).toBe('APPROVED')

    const noConfig = normalizePluginOptions({ channels: ['email'] })
    const failed = await whatsappStatusEndpoint(() => noConfig).handler({
      user: { id: 'a' },
      routeParams: { id: 't1' },
      payload: memory.payload,
    } as never)
    expect(failed.status).toBe(502)
  })
})
