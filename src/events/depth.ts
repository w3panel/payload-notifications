import type { PayloadRequest } from 'payload'

/** `req.context` key carrying how many notification-processing levels are active. */
export const EVENT_DEPTH_CONTEXT_KEY = 'payloadNotificationsDepth'

export const DEFAULT_MAX_EVENT_DEPTH = 3

/** Processing depth of the request (0 for ordinary user actions). */
export const getEventDepth = (req: Pick<PayloadRequest, 'context'> | undefined): number => {
  const value = req?.context?.[EVENT_DEPTH_CONTEXT_KEY]
  return typeof value === 'number' && value >= 0 ? value : 0
}

/** Marks a job request as processing an event at `depth`, so writes made with it carry the depth. */
export const setEventDepth = (req: PayloadRequest | undefined, depth: number) => {
  if (!req) return
  req.context = { ...req.context, [EVENT_DEPTH_CONTEXT_KEY]: depth }
}
