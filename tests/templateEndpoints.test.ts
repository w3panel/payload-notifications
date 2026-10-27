import { describe, expect, it, mock } from 'bun:test'
import { normalizePluginOptions } from '../src/config/normalizePluginOptions'
import { createTemplateTestSendHandler } from '../src/endpoints/templateTestSend'
import { NotificationTemplatesCollection } from '../src/collections/NotificationTemplates'
import { buildTemplateApiPath, parsePreviewContext } from '../src/admin/previewHelpers'

describe('template endpoints and helpers', () => {
  it('parses preview context JSON', () => {
    const ok = parsePreviewContext('{"payload":{"orderId":"1"}}')
    expect(ok.ok).toBe(true)
    if (ok.ok) expect(ok.value.payload).toEqual({ orderId: '1' })

    const bad = parsePreviewContext('{')
    expect(bad.ok).toBe(false)
  })

  it('builds collection API paths', () => {
    expect(buildTemplateApiPath('notification-templates', 'preview')).toBe(
      '/api/notification-templates/preview',
    )
  })

  it('registers preview and test-send endpoints on the templates collection', () => {
    const collection = NotificationTemplatesCollection({
      getOptions: () => normalizePluginOptions(),
    })
    const paths = (collection.endpoints || []).map((endpoint) => endpoint.path)
    expect(paths).toContain('/preview')
    expect(paths).toContain('/test-send')
  })

  it('test-send rejects unauthenticated requests', async () => {
    const handler = createTemplateTestSendHandler(() => normalizePluginOptions())
    const res = await handler({ user: null, json: async () => ({}) } as never)
    expect(res.status).toBe(401)
  })

  it('test-send dispatches in-app for authenticated users', async () => {
    const create = mock(async () => ({}))
    const handler = createTemplateTestSendHandler(() => normalizePluginOptions())
    const res = await handler({
      user: { id: 'admin' },
      payload: {
        create,
        findByID: mock(async () => ({ id: 'user_1' })),
      },
      json: async () => ({
        channel: 'inapp',
        userId: 'user_1',
        doc: {
          slug: 'order.paid',
          inapp: { title: 'Hi', body: 'Hello {{ payload.x }}' },
        },
        context: { x: 'world' },
      }),
    } as never)

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.ok).toBe(true)
    expect(data.result.status).toBe('stored')
    expect(create.mock.calls.length).toBeGreaterThan(0)
  })
})
