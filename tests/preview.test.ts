import { describe, expect, it } from 'bun:test'
import { previewTemplateDoc } from '../src/templates/preview'
import { buildDefinitionFromTemplateDoc } from '../src/templates/fromDoc'
import { renderDefinition } from '../src/templates/renderDefinition'
import { createTemplatePreviewHandler } from '../src/endpoints/templatePreview'

describe('preview + htmlBody fidelity', () => {
  it('builds email definition with htmlBody and textBody', () => {
    const definition = buildDefinitionFromTemplateDoc(
      {
        email: {
          subject: 'Hello {{ payload.name }}',
          htmlBody: '<h1>{{ payload.name }}</h1>',
          textBody: 'Hello {{ payload.name }}',
        },
      },
      'email',
    )

    expect(definition.htmlBody).toContain('<h1>')
    expect(definition.textBody).toContain('Hello')
  })

  it('renders htmlBody as HTML without wrapping escaped paragraphs', () => {
    const rendered = renderDefinition(
      {
        subject: 'Order {{ payload.orderId }}',
        body: 'fallback',
        textBody: 'Order {{ payload.orderId }} text',
        htmlBody: '<p><strong>Order {{ payload.orderId }}</strong></p>',
      },
      {
        event: 'order.paid',
        userId: 'user_1',
        payload: { orderId: 'ORD-9' },
      },
    )

    expect(rendered.subject).toBe('Order ORD-9')
    expect(rendered.text).toBe('Order ORD-9 text')
    expect(rendered.html).toBe('<p><strong>Order ORD-9</strong></p>')
  })

  it('previews draft docs for in-app channel', () => {
    const rendered = previewTemplateDoc({
      doc: {
        slug: 'order.paid',
        inapp: {
          title: 'Paid',
          body: 'Order {{ payload.orderId }} paid',
        },
      },
      channel: 'inapp',
      context: {
        event: 'order.paid',
        userId: 'user_1',
        payload: { orderId: 'A1' },
      },
    })

    expect(rendered.title).toBe('Paid')
    expect(rendered.body).toBe('Order A1 paid')
  })

  it('preview endpoint rejects unauthenticated requests', async () => {
    const handler = createTemplatePreviewHandler()
    const res = await handler({ user: null, json: async () => ({}) } as never)
    expect(res.status).toBe(401)
  })

  it('preview endpoint returns rendered content for authenticated users', async () => {
    const handler = createTemplatePreviewHandler()
    const res = await handler({
      user: { id: 'admin' },
      json: async () => ({
        channel: 'email',
        doc: {
          slug: 'order.paid',
          email: {
            subject: 'Hi {{ payload.name }}',
            textBody: 'Body {{ payload.name }}',
            htmlBody: '<b>{{ payload.name }}</b>',
          },
        },
        context: {
          event: 'order.paid',
          userId: 'user_1',
          payload: { name: 'Ada' },
        },
      }),
    } as never)

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.ok).toBe(true)
    expect(data.rendered.subject).toBe('Hi Ada')
    expect(data.rendered.html).toBe('<b>Ada</b>')
  })
})
