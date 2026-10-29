import { describe, expect, it } from 'bun:test'
import { accessWithTenant, denyUnless, tenantWhere, userTenant } from '../src/admin-ops/access'
import { normalizePluginOptions } from '../src/config/normalizePluginOptions'
import { compileDesignEndpoint } from '../src/endpoints/compileDesign'
import { createDataSourcesListHandler } from '../src/endpoints/dataSources'
import { createTemplatePreviewHandler } from '../src/endpoints/templatePreview'
import { registerCollections } from '../src/plugin'

const req = (user: Record<string, unknown> | null) => ({ user, payload: {} }) as never
const isStaff = ({ req: r }: { req: { user?: { role?: string } | null } }) =>
  r.user?.role === 'staff'

describe('notification permissions', () => {
  it('default every check to access.isAdmin, except raw HTML', async () => {
    const options = normalizePluginOptions({ access: { isAdmin: isStaff as never } })
    for (const name of [
      'manageTriggers',
      'publishTriggers',
      'manageTemplates',
      'publishTemplates',
      'testSend',
      'viewDeliveries',
      'retryDeliveries',
      'managePreferences',
    ] as const) {
      expect(await options.access[name]({ req: req({ role: 'staff' }) })).toBe(true)
      expect(await options.access[name]({ req: req({ role: 'customer' }) })).toBe(false)
    }
    expect(await options.access.rawHtml({ req: req({ role: 'staff' }) })).toBe(false)
  })

  it('scopes operational records to the user tenant', async () => {
    const options = normalizePluginOptions({ tenancy: { field: 'tenant', userField: 'clinic' } })
    expect(userTenant(req({ clinic: { id: 'c1' } }), options)).toBe('c1')
    expect(tenantWhere(req({ clinic: 'c1' }), options)).toEqual({ tenant: { equals: 'c1' } })
    expect(tenantWhere(req({ clinic: null }), options)).toBeUndefined()
    expect(tenantWhere(req({ clinic: 'c1' }), normalizePluginOptions())).toBeUndefined()

    const read = accessWithTenant(() => options, 'viewDeliveries', 'delivery.tenant')
    expect(await read({ req: req({ clinic: 'c1' }) } as never)).toEqual({
      'delivery.tenant': { equals: 'c1' },
    })
    expect(await read({ req: req({ id: 'platform' }) } as never)).toBe(true)
    expect(await read({ req: req(null) } as never)).toBe(false)
  })

  it('applies the checks to plugin collections, keeping host overrides', async () => {
    const options = normalizePluginOptions({
      access: { viewDeliveries: () => false, manageTemplates: isStaff as never },
      tenancy: { field: 'tenant' },
    })
    const collections = registerCollections([], options, {
      logs: { access: { read: () => true } },
    })
    const bySlug = (slug: string) => collections.find((collection) => collection.slug === slug)!
    expect(
      await bySlug('notification-deliveries').access!.read!({ req: req({ id: 'a' }) } as never),
    ).toBe(false)
    expect(
      await bySlug('notification-logs').access!.read!({ req: req({ id: 'a' }) } as never),
    ).toBe(true)
    const templates = bySlug('notification-templates').access!
    expect(await templates.update!({ req: req({ role: 'staff' }) } as never)).toBe(true)
    expect(await templates.create!({ req: req({ role: 'customer' }) } as never)).toBe(false)

    const permitted = normalizePluginOptions({ tenancy: { field: 'tenant' } })
    const scoped = registerCollections([], permitted)
    const deliveries = scoped.find((collection) => collection.slug === 'notification-deliveries')!
    expect(await deliveries.access!.read!({ req: req({ tenant: 't9' }) } as never)).toEqual({
      tenant: { equals: 't9' },
    })
    expect(deliveries.fields.some((field) => 'name' in field && field.name === 'tenant')).toBe(true)
  })

  it('protects preview, compile and inspector endpoints', async () => {
    const options = () =>
      normalizePluginOptions({
        access: { manageTemplates: () => false, manageTriggers: () => false },
      })
    const call = {
      user: { id: 'a' },
      payload: {},
      json: async () => ({ channel: 'email', doc: {} }),
    } as never
    expect((await createTemplatePreviewHandler(options)(call)).status).toBe(403)
    expect((await compileDesignEndpoint(options).handler(call)).status).toBe(403)
    expect((await createDataSourcesListHandler(options)(call)).status).toBe(403)
    expect((await denyUnless(req(null), () => true))?.status).toBe(401)
    expect(await denyUnless(req({ id: 'a' }), [() => false, () => true])).toBeUndefined()
  })
})

describe('tenant on deliveries', () => {
  it("records the event's tenant on planned deliveries", async () => {
    const { createMemoryPayload } = await import('./helpers/memoryPayload')
    const { processEvent } = await import('../src/jobs/processEvent')
    const memory = createMemoryPayload({
      users: [{ id: 'u1', email: 'u1@example.com', tenant: 'clinic-1' }],
    })
    const options = normalizePluginOptions({
      tenancy: { field: 'tenant' },
      templates: { registry: { 'booking.made': { email: { subject: 'Booked', body: 'Booked' } } } },
      triggers: [
        {
          slug: 'booking',
          event: 'booking.made',
          recipients: [{ type: 'eventUser' }],
          deliveries: [{ channel: 'email', template: 'booking.made' }],
        },
      ],
    })
    await processEvent({
      payload: memory.payload,
      options,
      event: { name: 'booking.made', eventId: 'e1', userId: 'u1', tenant: 'clinic-1', payload: {} },
    })
    expect(memory.docs('notification-deliveries')[0]).toMatchObject({ tenant: 'clinic-1' })
  })
})
