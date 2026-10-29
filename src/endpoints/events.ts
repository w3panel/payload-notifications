import type { Endpoint, PayloadRequest } from 'payload'
import type { NormalizedNotificationsPluginOptions } from '../types'
import { listRegisteredEvents } from '../events/registry'

export const createEventsListHandler = (getOptions: () => NormalizedNotificationsPluginOptions) => {
  return async (req: PayloadRequest) => {
    if (!req.user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    return Response.json({ events: listRegisteredEvents(getOptions()) })
  }
}

/** `GET /api/notifications/events` — registered application events for admin pickers. */
export const eventsListEndpoint = (
  getOptions: () => NormalizedNotificationsPluginOptions,
  path = '/notifications/events',
): Endpoint => ({
  path,
  method: 'get',
  handler: createEventsListHandler(getOptions),
})
