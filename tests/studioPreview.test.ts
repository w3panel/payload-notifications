import { describe, expect, it, mock } from 'bun:test'
import { normalizePluginOptions } from '../src/config/normalizePluginOptions'
import { createTemplatePreviewHandler } from '../src/endpoints/templatePreview'
import { auditEmail, contrastRatio, GMAIL_CLIP_BYTES } from '../src/studio/audit'

type Doc = Record<string, unknown>

describe('email checks', () => {
  it('computes WCAG contrast', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0)
    expect(contrastRatio('#777', '#fff')).toBeCloseTo(4.48, 1)
    expect(contrastRatio('red', '#fff')).toBeUndefined()
  })

  it('flags missing alt text, empty and generic links', () => {
    const checks = auditEmail({
      html: '<img src="a.png"><img src="b.png" alt="Logo"><a href="x"></a><a href="y">Click here</a><a href="z"><img src="c" alt="Shop"></a><a href="w">Track order</a>',
    })
    expect(checks).toEqual([
      { level: 'error', message: '1 image(s) have no alt text' },
      { level: 'error', message: 'A link has no text' },
      { level: 'warning', message: 'Link text "Click here" does not say where it goes' },
    ])
  })

  it('warns about low contrast in the design and theme', () => {
    const checks = auditEmail({
      html: '',
      design: {
        version: 1,
        blocks: [
          { id: 'b', type: 'button', label: 'Go', href: 'https://x', background: '#ffff00' },
          {
            id: 's',
            type: 'section',
            background: '#bbbbbb',
            children: [{ id: 't', type: 'text', text: 'Dark on dark' }],
          },
        ],
      },
      theme: { colors: { text: '#aaaaaa' } },
    })
    expect(checks.map((check) => check.blockId ?? check.message)).toEqual([
      'Body text: contrast 2.3:1 is below 4.5:1',
      'b',
      't',
    ])
  })

  it('warns when Gmail would clip the email', () => {
    const checks = auditEmail({ html: 'x'.repeat(GMAIL_CLIP_BYTES + 1) })
    expect(checks[0].message).toMatch(/Gmail clips messages over 102 KB/)
  })
})

describe('template preview', () => {
  const options = () =>
    normalizePluginOptions({
      events: {
        'order.paid': { samplePayload: { orderId: 'SAMPLE-1', total: 10 } },
      },
      collectionEvents: { orders: { capture: ['status', 'total'], userField: 'customer' } },
      triggers: [
        {
          slug: 'paid-mail',
          source: { type: 'event', event: 'order.paid' },
          recipients: [{ type: 'eventUser' }],
          deliveries: [{ channel: 'email', template: 'order.paid' }],
          data: { sources: [{ type: 'resolver', alias: 'store', name: 'store' }] },
        } as never,
      ],
      dataResolvers: { store: () => ({ name: 'Acme' }) },
    })
  const findByID = mock(async ({ collection, id, overrideAccess }: Doc) => {
    if (collection === 'orders' && id === 'o1')
      return { id: 'o1', status: 'shipped', total: 99, customer: 'u1', secret: 'x' }
    if (overrideAccess === false) return null
    throw new Error('not found')
  })
  const payload = {
    findByID,
    find: async () => ({ docs: [] }),
    findGlobal: async () => ({ colors: { primary: '#0f766e' } }),
    config: {},
  }
  const request = (body: Doc) =>
    ({ user: { id: 'admin' }, payload, json: async () => body }) as never
  const handler = createTemplatePreviewHandler(options)
  const textDoc = (textBody: string) => ({ slug: 'order.paid', email: { subject: 'S', textBody } })

  it('uses the event sample payload', async () => {
    const res = await handler(
      request({
        channel: 'email',
        doc: textDoc('Order {{ payload.orderId }}'),
        context: { payload: { orderId: 'FROM-JSON' } },
        sample: { kind: 'event' },
      }),
    )
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.rendered.text).toBe('Order SAMPLE-1')
  })

  it('uses a real document read with the caller access', async () => {
    const res = await handler(
      request({
        channel: 'email',
        doc: textDoc('Status {{ doc.status }} {{ doc.secret }}'),
        sample: { kind: 'document', collection: 'orders', id: 'o1' },
      }),
    )
    const body = await res.json()
    expect(body.rendered.text).toBe('Status shipped ')
    const call = findByID.mock.calls.find(
      ([args]) => (args as Doc).collection === 'orders',
    )?.[0] as Doc
    expect(call.overrideAccess).toBe(false)

    const denied = await handler(
      request({
        channel: 'email',
        doc: textDoc('x'),
        sample: { kind: 'document', collection: 'users', id: 'u1' },
      }),
    )
    expect(denied.status).toBe(400)
  })

  it("uses a trigger's event and data sources", async () => {
    const res = await handler(
      request({
        channel: 'email',
        doc: textDoc('{{ payload.orderId }} at {{ store.name }}'),
        sample: { kind: 'trigger', trigger: 'paid-mail' },
      }),
    )
    expect((await res.json()).rendered.text).toBe('SAMPLE-1 at Acme')
    const missing = await handler(
      request({
        channel: 'email',
        doc: textDoc('x'),
        sample: { kind: 'trigger', trigger: 'nope' },
      }),
    )
    expect(missing.status).toBe(404)
  })

  it('compiles unsaved visual designs with the theme and returns checks', async () => {
    const res = await handler(
      request({
        channel: 'email',
        doc: {
          slug: 'order.paid',
          email: {
            editor: 'visual',
            subject: 'Order {{ payload.orderId }}',
            preheader: 'Thanks!',
            htmlBody: '<p>stale</p>',
            design: {
              version: 1,
              blocks: [
                { id: 't', type: 'text', text: 'Order **{{ payload.orderId }}**' },
                { id: 'b', type: 'button', label: 'Click here', href: 'https://x' },
              ],
            },
          },
        },
        sample: { kind: 'event' },
      }),
    )
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.rendered.subject).toBe('Order SAMPLE-1')
    expect(body.rendered.preheader).toBe('Thanks!')
    expect(body.rendered.html).toContain('<strong>SAMPLE-1</strong>')
    expect(body.rendered.html).toContain('bgcolor="#0f766e"')
    expect(body.rendered.html).not.toContain('stale')
    expect(body.checks).toEqual([
      { level: 'warning', message: 'Link text "Click here" does not say where it goes' },
    ])
  })

  it('reports invalid designs', async () => {
    const res = await handler(
      request({
        channel: 'email',
        doc: {
          slug: 'order.paid',
          email: { editor: 'visual', design: { version: 1, blocks: [{ id: 'x', type: 'nope' }] } },
        },
      }),
    )
    expect(res.status).toBe(400)
    expect((await res.json()).errors).toEqual(['blocks[0]: unknown block type "nope"'])
  })
})

describe('preview requests', () => {
  it('builds bodies for each sample choice', async () => {
    const { buildPreviewBody } = await import('../src/admin/previewHelpers')
    const doc = { slug: 'order.paid' }
    expect(
      buildPreviewBody({
        channel: 'email',
        doc,
        contextJson: '{"payload":{"a":1}}',
        sample: { kind: 'json' },
      }),
    ).toEqual({
      ok: true,
      body: { channel: 'email', doc, context: { payload: { a: 1 } } },
    })
    expect(
      buildPreviewBody({ channel: 'sms', doc, contextJson: '', sample: { kind: 'event' } }),
    ).toEqual({
      ok: true,
      body: { channel: 'sms', doc, sample: { kind: 'event' } },
    })
    expect(
      buildPreviewBody({
        channel: 'email',
        doc,
        contextJson: '',
        sample: { kind: 'document', collection: ' orders ', id: '7' },
      }),
    ).toEqual({
      ok: true,
      body: { channel: 'email', doc, sample: { kind: 'document', collection: 'orders', id: '7' } },
    })
    expect(
      buildPreviewBody({
        channel: 'email',
        doc,
        contextJson: '',
        sample: { kind: 'trigger', trigger: '' },
      }).ok,
    ).toBe(false)
    expect(
      buildPreviewBody({ channel: 'email', doc, contextJson: '{', sample: { kind: 'json' } }).ok,
    ).toBe(false)
  })

  it('injects the dark-mode simulation into the document head', async () => {
    const { previewSrcDoc, DARK_MODE_CSS } = await import('../src/admin/previewHelpers')
    expect(previewSrcDoc('<html><head></head><body>x</body></html>')).toBe(
      '<html><head></head><body>x</body></html>',
    )
    expect(previewSrcDoc('<html><head></head><body>x</body></html>', { dark: true })).toBe(
      `<html><head><style>${DARK_MODE_CSS}</style></head><body>x</body></html>`,
    )
    expect(previewSrcDoc('<p>x</p>', { dark: true }).startsWith('<style>')).toBe(true)
  })
})
