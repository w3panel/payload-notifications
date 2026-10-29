import { describe, expect, it, mock } from 'bun:test'
import { normalizePluginOptions } from '../src/config/normalizePluginOptions'
import { createTemplateTestSendHandler, markAsTest } from '../src/endpoints/templateTestSend'

describe('test sends from the studio', () => {
  it('marks content as a test without touching approved WhatsApp templates', () => {
    const base = { body: 'Hi', text: 'Hi', html: '' }
    expect(markAsTest({ ...base, subject: 'Order' }, 'email').subject).toBe('[Test] Order')
    expect(markAsTest({ ...base, subject: '[Test] Order' }, 'email').subject).toBe('[Test] Order')
    expect(markAsTest(base, 'sms')).toMatchObject({ body: '[Test] Hi', text: '[Test] Hi' })
    const hsm = { ...base, whatsappTemplate: { name: 'x', language: 'en', parameters: [] } }
    expect(markAsTest(hsm, 'whatsapp')).toBe(hsm)
    expect(markAsTest({ ...base, title: 'T' }, 'inapp').title).toBe('[Test] T')
  })

  it('sends the unsaved visual design with the event sample to the admin', async () => {
    const options = normalizePluginOptions({
      events: { 'order.paid': { samplePayload: { orderId: 'SAMPLE-9' } } },
    })
    const sendEmail = mock(async (args: { to: string; subject: string; html: string }) => args)
    const handler = createTemplateTestSendHandler(() => options)
    const res = await handler({
      user: { id: 'admin' },
      payload: {
        findByID: async ({ collection }: { collection: string }) =>
          collection === 'users' ? { id: 'admin', email: 'admin@example.com' } : null,
        findGlobal: async () => ({}),
        find: async () => ({ docs: [] }),
        create: async (args: { data: unknown }) => args.data,
        sendEmail,
        config: {},
      },
      json: async () => ({
        channel: 'email',
        sample: { kind: 'event' },
        doc: {
          slug: 'order.paid',
          email: {
            editor: 'visual',
            subject: 'Order {{ payload.orderId }}',
            htmlBody: '<p>stale</p>',
            design: {
              version: 1,
              blocks: [{ id: 't', type: 'text', text: 'Paid **{{ payload.orderId }}**' }],
            },
          },
        },
      }),
    } as never)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.result.status).toBe('sent')
    const sent = sendEmail.mock.calls[0][0]
    expect(sent.to).toBe('admin@example.com')
    expect(sent.subject).toBe('[Test] Order SAMPLE-9')
    expect(sent.html).toContain('<strong>SAMPLE-9</strong>')
    expect(sent.html).not.toContain('stale')
  })
})
