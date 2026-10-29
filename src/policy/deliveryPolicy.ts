import type { Payload } from 'payload'
import type {
  NormalizedNotificationsPluginOptions,
  NotificationChannel,
  NotificationClassification,
  NotificationPolicyDecision,
  NotificationSendInput,
} from '../types'
import { evaluateNotificationPolicy } from './evaluatePolicy'
import { findSuppression } from './suppressions'

/** A delivery's category: the trigger category, else its classification. */
export const deliveryCategory = (category?: string | null, classification?: string | null) =>
  category || classification || 'transactional'

/** Whether opt-outs are ignored for this delivery (collection mode). */
export const isMandatory = (
  options: NormalizedNotificationsPluginOptions,
  category: string,
  classification?: NotificationClassification,
) => {
  const mandatory = options.preferences.mandatoryCategories
  return (
    mandatory.includes(category) ||
    (classification !== 'marketing' && mandatory.includes('transactional'))
  )
}

type PreferenceDoc = {
  channel?: string
  category?: string
  enabled?: boolean
  updatedAt?: string
}

/** Most specific preference: category+channel > category+* > *+channel > *+*. */
export const pickPreference = (
  docs: PreferenceDoc[],
  category: string,
  channel: NotificationChannel,
): PreferenceDoc | undefined => {
  const rank = (doc: PreferenceDoc) => {
    const categoryMatch = doc.category === category ? 2 : doc.category === '*' ? 1 : 0
    const channelMatch = doc.channel === channel ? 1 : doc.channel === '*' ? 0.5 : 0
    return categoryMatch && channelMatch ? categoryMatch * 2 + channelMatch : 0
  }
  return docs
    .filter((doc) => rank(doc) > 0)
    .sort((a, b) => rank(b) - rank(a) || String(b.updatedAt).localeCompare(String(a.updatedAt)))[0]
}

/**
 * Send-time policy for a delivery: suppression list, then (collection mode)
 * mandatory categories, category / channel preferences and marketing opt-in,
 * then (user-fields mode) the existing preference fields, then `canSend`.
 * Trigger settings never override consent.
 */
export const evaluateDeliveryPolicy = async ({
  payload,
  options,
  user,
  input,
  destination,
  category,
}: {
  payload: Payload
  options: NormalizedNotificationsPluginOptions
  user: Record<string, unknown>
  input: NotificationSendInput
  destination?: string
  category: string
}): Promise<NotificationPolicyDecision> => {
  if (destination) {
    const suppression = await findSuppression(payload, options, input.channel, destination)
    if (suppression) {
      return {
        allow: false,
        reason: `Destination is suppressed (${suppression.reason ?? 'manual'})`,
      }
    }
  }

  if (options.preferences.mode === 'userFields') {
    return evaluateNotificationPolicy({ user, input, options })
  }

  if (input.userId && !isMandatory(options, category, input.classification)) {
    const result = await payload.find({
      collection: options.collections.preferences as never,
      where: { user: { equals: input.userId } },
      limit: 200,
      depth: 0,
      overrideAccess: true,
      pagination: false,
    })
    const preference = pickPreference(result.docs as PreferenceDoc[], category, input.channel)
    if (preference?.enabled === false) {
      return { allow: false, reason: `User opted out of ${category} via ${input.channel}` }
    }
    if (
      input.classification === 'marketing' &&
      options.preferences.marketingRequiresOptIn &&
      preference?.enabled !== true
    ) {
      return { allow: false, reason: 'User has not opted in to marketing notifications' }
    }
  }

  if (options.policy.canSend) {
    const decision = await options.policy.canSend({
      channel: input.channel,
      event: input.event,
      classification: input.classification,
      user,
      payload: input.eventPayload,
    })
    if (!decision.allow) {
      return { allow: false, reason: decision.reason || 'Notification delivery blocked by policy' }
    }
  }
  return { allow: true }
}
