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

  it('test-send dispatches in-app to the current admin, marked as a test', async () => {
    const create = mock(
      async (args: { collection: string; data: Record<string, unknown> }) => args.data,
    )
    const handler = createTemplateTestSendHandler(() => normalizePluginOptions())
    const request = (extra: Record<string, unknown> = {}) =>
      ({
        user: { id: 'admin' },
        payload: {
          create,
          findByID: mock(async () => ({ id: 'admin' })),
        },
        json: async () => ({
          channel: 'inapp',
          doc: {
            slug: 'order.paid',
            inapp: { title: 'Hi', body: 'Hello {{ payload.x }}' },
          },
          context: { x: 'world' },
          ...extra,
        }),
      }) as never
    const res = await handler(request())

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.ok).toBe(true)
    expect(data.result.status).toBe('stored')
    const stored = create.mock.calls.find(([args]) => args.collection === 'notifications')?.[0].data
    expect(stored).toMatchObject({ recipient: 'admin', title: '[Test] Hi', message: 'Hello world' })

    const other = await handler(request({ userId: 'user_1' }))
    expect(other.status).toBe(400)
    expect((await other.json()).error).toBe('Test sends go to your own account only')
  })
})
