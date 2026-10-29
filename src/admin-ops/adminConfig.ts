import type { Config } from 'payload'
import type { NormalizedNotificationsPluginOptions } from '../types'

export const DASHBOARD_COMPONENT = '@wtree/payload-notifications/admin#NotificationsDashboard'

/** Adds the plugin's admin components (dashboard) to the host config. */
export const withAdminComponents = (
  config: Config,
  options: NormalizedNotificationsPluginOptions,
): Config['admin'] => {
  const admin = config.admin ?? {}
  if (!options.admin.dashboard) return config.admin
  const clientProps = {
    apiRoute: config.routes?.api ?? '/api',
    adminRoute: config.routes?.admin ?? '/admin',
    deliveriesSlug: options.collections.deliveries,
  }
  const beforeDashboard = admin.components?.beforeDashboard ?? []
  const already = beforeDashboard.some(
    (entry) =>
      (typeof entry === 'string' ? entry : (entry as { path?: string })?.path) ===
      DASHBOARD_COMPONENT,
  )
  return {
    ...admin,
    components: {
      ...admin.components,
      beforeDashboard: already
        ? beforeDashboard
        : [...beforeDashboard, { path: DASHBOARD_COMPONENT, clientProps }],
    },
  }
}
