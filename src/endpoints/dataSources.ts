import type { Endpoint, PayloadRequest } from 'payload'
import type { NormalizedNotificationsPluginOptions } from '../types'
import { denyUnless } from '../admin-ops/access'
import { listDataFunctions } from '../data/resolvers'

export const createDataSourcesListHandler = (
  getOptions: () => NormalizedNotificationsPluginOptions,
) => {
  return async (req: PayloadRequest) => {
    const options = getOptions()
    const denied = await denyUnless(req, [
      options.access.manageTriggers,
      options.access.manageTemplates,
    ])
    if (denied) return denied
    return Response.json({
      collections: Object.entries(options.data.collections)
        .map(([slug, entry]) => ({ slug, label: entry.label || slug, fields: entry.fields }))
        .sort((a, b) => a.slug.localeCompare(b.slug)),
      ...listDataFunctions(options),
    })
  }
}

/**
 * `GET /api/payload-notifications/data-sources` — allowlisted collections/fields and
 * registered resolvers / computed functions, for admin pickers.
 */
export const dataSourcesListEndpoint = (
  getOptions: () => NormalizedNotificationsPluginOptions,
  path = '/payload-notifications/data-sources',
): Endpoint => ({
  path,
  method: 'get',
  handler: createDataSourcesListHandler(getOptions),
})
