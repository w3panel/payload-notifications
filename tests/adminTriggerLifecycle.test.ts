import { describe, expect, it, mock } from 'bun:test'
import { runLifecycleAction, triggerLifecycleEndpoint } from '../src/admin-triggers/lifecycle'
import { createAdminTriggerCache, loadPublishedAdminTriggers } from '../src/admin-triggers/store'
import { normalizePluginOptions } from '../src/config/normalizePluginOptions'
import { notificationsPlugin } from '../src/plugin'
import type { NotificationsPluginOptions } from '../src/types'
import { createMemoryPayload } from './helpers/memoryPayload'

type Doc = Record<string, unknown>

const pluginOptions: NotificationsPluginOptions = {
  channels: ['email', 'inapp'],
  events: { 'order.paid': { classification: 'transactional', samplePayload: { orderId: 'o1' } } },
  adminTriggers: { cancelQueuedOnDisable: true },
}
const options = normalizePluginOptions(pluginOptions)

const draft = (extra: Doc = {}) => ({
  id: 't1',
  slug: 'ops-alert',
  name: 'Ops alert',
  status: 'draft',
  version: 0,
  source: { type: 'event', event: 'order.paid' },
  recipients: [{ type: 'static', email: 'ops@example.com', alias: 'ops' }],
  deliveries: [{ channel: 'email', template: 'order.paid', recipient: 'ops' }],
  ...extra,
})

const setup = (doc: Doc = draft()) => {
  const memory = createMemoryPayload({ 'notification-triggers': [doc], users: [{ id: 'admin' }] })
  const act = (action: string, extra: Doc = {}) =>
    runLifecycleAction({
      payload: memory.payload,
      options,
      id: 't1',
      action: action as never,
      user: { id: 'admin' },
      ...extra,
    })
  return { memory, act, trigger: () => memory.docs('notification-triggers')[0] }
}

describe('trigger lifecycle', () => {
  it('validates a draft into validated, or keeps it a draft with the report', async () => {
    const ok = setup()
    expect((await ok.act('validate')).body.ok).toBe(true)
    expect(ok.trigger()).toMatchObject({ status: 'validated', validation: { ok: true } })

    const bad = setup(
      draft({ deliveries: [{ channel: 'sms', template: 'order.paid', recipient: 'ops' }] }),
    )
    const result = await bad.act('validate')
    expect(result.body.ok).toBe(false)
    expect(bad.trigger().status).toBe('draft')
    expect((bad.trigger().validation as Doc).errors).toEqual([
      'trigger "ops-alert" deliveries[0]: channel "sms" is not enabled in plugin channels',
    ])
  })

  it('publishes an immutable snapshot and bumps the version', async () => {
    const { memory, act, trigger } = setup()
    const result = await act('publish')
    expect(result.status).toBe(200)
    expect(trigger()).toMatchObject({
      status: 'published',
      version: 1,
      publishedBy: 'admin',
      hasUnpublishedChanges: false,
    })
    expect(memory.docs('notification-trigger-versions')).toEqual([
      expect.objectContaining({
        trigger: 't1',
        slug: 'ops-alert',
        version: 1,
        definition: {
          source: { type: 'event', event: 'order.paid' },
          recipients: [{ type: 'static', email: 'ops@example.com', alias: 'ops' }],
          deliveries: [{ channel: 'email', template: 'order.paid', recipient: 'ops' }],
        },
      }),
    ])
  })

  it('blocks publishing on validation errors', async () => {
    const { memory, act, trigger } = setup(
      draft({ source: { type: 'event', event: 'unknown.event' } }),
    )
    const result = await act('publish')
    expect(result.status).toBe(422)
    expect(result.body.report?.errors[0]).toContain('is not a registered application event')
    expect(trigger().status).toBe('draft')
    expect(memory.docs('notification-trigger-versions')).toHaveLength(0)
  })

  it('runs the published snapshot, not later edits, until republished', async () => {
    const { memory, act, trigger } = setup()
    await act('publish')
    // An unpublished edit to the working copy
    trigger().deliveries = [{ channel: 'inapp', template: 'order.paid', recipient: 'ops' }]
    trigger().hasUnpublishedChanges = true

    const live = await loadPublishedAdminTriggers(memory.payload, options)
    expect(live).toEqual([
      expect.objectContaining({
        slug: 'ops-alert',
        version: 1,
        deliveries: [{ channel: 'email', template: 'order.paid', recipient: 'ops' }],
      }),
    ])

    // Publishing the edit makes version 2 live
    trigger().deliveries = [{ channel: 'email', template: 'order.shipped', recipient: 'ops' }]
    await act('publish')
    const republished = await loadPublishedAdminTriggers(memory.payload, options)
    expect(republished[0]).toMatchObject({
      version: 2,
      deliveries: [{ template: 'order.shipped' }],
    })
  })

  it('disables (cancelling queued deliveries), enables and archives', async () => {
    const { memory, act, trigger } = setup()
    await act('publish')
    memory.db['notification-deliveries'] = [
      { id: 'd1', trigger: 'ops-alert', status: 'queued' },
      { id: 'd2', trigger: 'ops-alert', status: 'sent' },
      { id: 'd3', trigger: 'other', status: 'queued' },
    ]

    const disabled = await act('disable')
    expect(disabled.body.cancelled).toBe(1)
    expect(memory.docs('notification-deliveries').map((d) => d.status)).toEqual([
      'cancelled',
      'sent',
      'queued',
    ])
    expect(await loadPublishedAdminTriggers(memory.payload, options)).toEqual([])

    expect((await act('enable')).status).toBe(200)
    expect(trigger().status).toBe('published')
    expect(await loadPublishedAdminTriggers(memory.payload, options)).toHaveLength(1)

    await act('archive')
    expect(trigger().status).toBe('archived')
    expect((await act('publish')).status).toBe(409)
    expect((await act('enable')).status).toBe(409)
  })

  it('rolls back by republishing an earlier version', async () => {
    const { memory, act, trigger } = setup()
    await act('publish')
    trigger().deliveries = [{ channel: 'inapp', template: 'order.paid', recipient: 'ops' }]
    trigger().recipients = [{ type: 'eventUser', alias: 'ops' }]
    await act('publish')

    const rolledBack = await act('rollback', { version: 1 })
    expect(rolledBack.status).toBe(200)
    expect(trigger()).toMatchObject({
      version: 3,
      deliveries: [{ channel: 'email', template: 'order.paid', recipient: 'ops' }],
    })
    expect(memory.docs('notification-trigger-versions').map((v) => v.version)).toEqual([1, 2, 3])
    expect((await act('rollback', { version: 9 })).status).toBe(404)
    expect((await act('rollback')).status).toBe(400)
  })
})

describe('lifecycle endpoint', () => {
  const call = async (user: Doc | null, body: Doc, opts = options) => {
    const memory = createMemoryPayload({ 'notification-triggers': [draft()] })
    const invalidate = mock(() => undefined)
    const endpoint = triggerLifecycleEndpoint(() => opts, { get: async () => [], invalidate })
    const res = await endpoint.handler({
      user,
      payload: memory.payload,
      routeParams: { id: 't1' },
      json: async () => body,
    } as never)
    return { res, invalidate }
  }

  it('checks actions and permissions', async () => {
    expect((await call({ id: 'a' }, { action: 'explode' })).res.status).toBe(400)
    expect((await call(null, { action: 'publish' })).res.status).toBe(401)

    const restricted = normalizePluginOptions({
      ...pluginOptions,
      access: { publishTriggers: ({ req }) => (req.user as Doc | null)?.role === 'publisher' },
    })
    expect(
      (await call({ id: 'e', role: 'editor' }, { action: 'publish' }, restricted)).res.status,
    ).toBe(403)
    expect(
      (await call({ id: 'e', role: 'editor' }, { action: 'validate' }, restricted)).res.status,
    ).toBe(200)

    const published = await call({ id: 'p', role: 'publisher' }, { action: 'publish' }, restricted)
    expect(published.res.status).toBe(200)
    expect(published.invalidate).toHaveBeenCalledTimes(1)
  })
})

describe('admin trigger cache', () => {
  it('reloads after the TTL or an invalidation and keeps the last set on errors', async () => {
    let clock = 0
    const memory = createMemoryPayload()
    const cache = createAdminTriggerCache(
      () => normalizePluginOptions({ adminTriggers: { cacheTtlMs: 1000 } }),
      () => clock,
    )
    await cache.get(memory.payload)
    await cache.get(memory.payload)
    expect(memory.find).toHaveBeenCalledTimes(1)

    clock = 1500
    await cache.get(memory.payload)
    expect(memory.find).toHaveBeenCalledTimes(2)

    cache.invalidate()
    memory.find.mockImplementation(async () => {
      throw new Error('db down')
    })
    expect(await cache.get(memory.payload)).toEqual([])
    expect(memory.logger.error).toHaveBeenCalledTimes(1)
  })
})

describe('published admin triggers in the pipeline', () => {
  it('match events through the plugin job handler', async () => {
    const config = notificationsPlugin(pluginOptions)({ collections: [] } as never)
    const memory = createMemoryPayload({ 'notification-triggers': [draft()] })
    await runLifecycleAction({ payload: memory.payload, options, id: 't1', action: 'publish' })

    const processTask = (
      config.jobs as { tasks: Array<{ slug: string; handler: (args: Doc) => Promise<unknown> }> }
    ).tasks.find((task) => task.slug === 'notification:process-event')!
    await processTask.handler({
      input: { name: 'order.paid', eventId: 'evt_1', payload: { orderId: 'o1' } },
      job: { id: 'j1' },
      req: { payload: memory.payload, context: {} },
    })

    expect(memory.docs('notification-deliveries')[0]).toMatchObject({
      trigger: 'ops-alert',
      triggerOrigin: 'admin',
      triggerVersion: 1,
      triggerPolicy: 'admin',
      destination: 'ops@example.com',
    })
  })
})
