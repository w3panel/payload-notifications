import type { CollectionConfig, Config, GlobalConfig } from 'payload'
import type { NormalizedNotificationsPluginOptions } from '../types'

export const DASHBOARD_COMPONENT = '@wtree/payload-notifications/admin#NotificationsDashboard'
export const NAV_LINKS_COMPONENT = '@wtree/payload-notifications/admin#NotificationsNavLinks'

const componentPath = (entry: unknown) =>
  typeof entry === 'string' ? entry : (entry as { path?: string } | undefined)?.path

const addOnce = <T>(list: T[] | undefined, path: string, entry: T): T[] => {
  const current = list ?? []
  return current.some((item) => componentPath(item) === path) ? current : [...current, entry]
}

/** Adds the plugin's admin components (dashboard, nav links) to the host config. */
export const withAdminComponents = (
  config: Config,
  options: NormalizedNotificationsPluginOptions,
): Config['admin'] => {
  if (!options.admin.dashboard && !options.admin.navLinks) return config.admin
  const admin = config.admin ?? {}
  const clientProps = {
    apiRoute: config.routes?.api ?? '/api',
    adminRoute: config.routes?.admin ?? '/admin',
    deliveriesSlug: options.collections.deliveries,
  }
  return {
    ...admin,
    components: {
      ...admin.components,
      ...(options.admin.dashboard
        ? {
            beforeDashboard: addOnce(admin.components?.beforeDashboard, DASHBOARD_COMPONENT, {
              path: DASHBOARD_COMPONENT,
              clientProps,
            }),
          }
        : {}),
      ...(options.admin.navLinks
        ? {
            afterNavLinks: addOnce(admin.components?.afterNavLinks, NAV_LINKS_COMPONENT, {
              path: NAV_LINKS_COMPONENT,
              clientProps: { adminRoute: clientProps.adminRoute },
            }),
          }
        : {}),
    },
  }
}

/** Nav order of the plugin's collections inside the group. */
export const navOrder = (options: NormalizedNotificationsPluginOptions): string[] => [
  options.collections.triggers,
  options.collections.templates,
  options.collections.partials,
  options.collections.deliveries,
  options.collections.logs,
  options.collections.events,
  options.collections.notifications,
  options.collections.preferences,
  options.collections.suppressions,
  options.collections.templateVersions,
  options.collections.triggerVersions,
]

/**
 * Puts the plugin's collections in nav order under `admin.group` (host
 * collections keep their place; a group set by the host wins).
 */
export const groupPluginCollections = (
  collections: CollectionConfig[],
  hostSlugs: Set<string>,
  options: NormalizedNotificationsPluginOptions,
): CollectionConfig[] => {
  const order = navOrder(options)
  const group = options.admin.group
  const host = collections.filter((collection) => hostSlugs.has(collection.slug))
  const plugin = collections
    .filter((collection) => !hostSlugs.has(collection.slug))
    .sort((a, b) => order.indexOf(a.slug) - order.indexOf(b.slug))
    .map((collection) =>
      group && collection.admin?.group === undefined
        ? { ...collection, admin: { ...collection.admin, group } }
        : collection,
    )
  return [...host, ...plugin]
}

/** The theme global in the nav group. */
export const groupGlobal = (
  global: GlobalConfig,
  options: NormalizedNotificationsPluginOptions,
): GlobalConfig => {
  const group = options.admin.group
  if (!group) return { ...global, admin: { ...global.admin, group: undefined } }
  return { ...global, admin: { ...global.admin, group } }
}
