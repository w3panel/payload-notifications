import type { Endpoint, PayloadRequest } from 'payload'
import type { NormalizedNotificationsPluginOptions } from '../types'
import { listDataFunctions } from '../data/resolvers'

export const createDataSourcesListHandler = (
  getOptions: () => NormalizedNotificationsPluginOptions,
) => {
  return async (req: PayloadRequest) => {
    if (!req.user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const options = getOptions()
    return Response.json({
      collections: Object.entries(options.data.collections)
        .map(([slug, entry]) => ({ slug, label: entry.label || slug, fields: entry.fields }))
        .sort((a, b) => a.slug.localeCompare(b.slug)),
      ...listDataFunctions(options),
    })
  }
}

/**
 * `GET /api/notifications/data-sources` — allowlisted collections/fields and
 * registered resolvers / computed functions, for admin pickers.
 */
export const dataSourcesListEndpoint = (
  getOptions: () => NormalizedNotificationsPluginOptions,
  path = '/notifications/data-sources',
): Endpoint => ({
  path,
  method: 'get',
  handler: createDataSourcesListHandler(getOptions),
})
