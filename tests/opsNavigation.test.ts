import { describe, expect, it } from 'bun:test'
import { DASHBOARD_COMPONENT, NAV_LINKS_COMPONENT } from '../src/admin-ops/adminConfig'
import { notificationsPlugin } from '../src/plugin'

describe('admin navigation', () => {
  const build = (
    options: Parameters<typeof notificationsPlugin>[0] = {},
    collections = [{ slug: 'users', fields: [] }],
  ) =>
    notificationsPlugin({ preferences: { mode: 'collection' }, eventsInbox: true, ...options })({
      collections,
      routes: { admin: '/cms' },
    } as never)

  it('groups plugin collections and the theme under Notifications in nav order', () => {
    const config = build()
    expect(config.collections?.map((collection) => collection.slug)).toEqual([
      'users',
      'notification-triggers',
      'notification-templates',
      'notification-template-partials',
      'notification-deliveries',
      'notification-logs',
      'notification-events',
      'notifications',
      'notification-preferences',
      'notification-suppressions',
      'notification-template-versions',
      'notification-trigger-versions',
    ])
    expect(config.collections?.find((c) => c.slug === 'users')?.admin?.group).toBeUndefined()
    expect(
      config.collections
        ?.filter((c) => c.slug !== 'users')
        .every((c) => c.admin?.group === 'Notifications'),
    ).toBe(true)
    expect(config.globals?.[0].admin?.group).toBe('Notifications')
  })

  it('uses a custom group or none', () => {
    expect(build({ admin: { group: 'Messaging' } }).collections?.[1].admin?.group).toBe('Messaging')
    const ungrouped = build({ admin: { group: false } })
    expect(ungrouped.collections?.[1].admin?.group).toBeUndefined()
    expect(ungrouped.globals?.[0].admin?.group).toBeUndefined()
  })

  it('adds nav links to the dashboard tabs', () => {
    const config = build()
    expect(config.admin?.components?.afterNavLinks).toEqual([
      { path: NAV_LINKS_COMPONENT, clientProps: { adminRoute: '/cms' } },
    ])
    expect(config.admin?.components?.beforeDashboard?.[0]).toMatchObject({
      path: DASHBOARD_COMPONENT,
    })
    const off = build({ admin: { dashboard: false } })
    expect(off.admin?.components?.afterNavLinks).toBeUndefined()
    expect(off.admin?.components?.beforeDashboard).toBeUndefined()
    expect(build({ admin: { navLinks: false } }).admin?.components?.afterNavLinks).toBeUndefined()
  })

  it('renders the nav links', async () => {
    const { renderToString } = await import('react-dom/server')
    const { createElement } = await import('react')
    const { NotificationsNavLinks } = await import('../src/admin/NotificationsNavLinks')
    const html = renderToString(createElement(NotificationsNavLinks, { adminRoute: '/cms' }))
    expect(html).toContain('href="/cms#notifications-overview"')
    expect(html).toContain('href="/cms#notifications-settings"')
  })
})
