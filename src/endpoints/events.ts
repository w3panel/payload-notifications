import type { Endpoint, PayloadRequest } from 'payload'
import type { NormalizedNotificationsPluginOptions } from '../types'
import { denyUnless } from '../admin-ops/access'
import { listRegisteredEvents } from '../events/registry'

export const createEventsListHandler = (getOptions: () => NormalizedNotificationsPluginOptions) => {
  return async (req: PayloadRequest) => {
    const options = getOptions()
    const denied = await denyUnless(req, [
      options.access.manageTriggers,
      options.access.manageTemplates,
    ])
    if (denied) return denied
    return Response.json({ events: listRegisteredEvents(options) })
  }
}

/** `GET /api/payload-notifications/events` — registered application events for admin pickers. */
export const eventsListEndpoint = (
  getOptions: () => NormalizedNotificationsPluginOptions,
  path = '/payload-notifications/events',
): Endpoint => ({
  path,
  method: 'get',
  handler: createEventsListHandler(getOptions),
})
