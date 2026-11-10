import type {
  NormalizedNotificationsPluginOptions,
  NotificationChannel,
  NotificationPolicyDecision,
  NotificationSendInput,
} from '../types'

const getNestedValue = (value: Record<string, unknown>, path: string): unknown => {
  return path.split('.').reduce<unknown>((current, key) => {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined
    return (current as Record<string, unknown>)[key]
  }, value)
}

const isChannelEnabledForUser = ({
  user,
  channel,
  options,
}: {
  user: Record<string, unknown>
  channel: NotificationChannel
  options: NormalizedNotificationsPluginOptions
}): boolean => {
  const mapped = getNestedValue(user, options.preferences.fields.channels)

  if (!mapped || typeof mapped !== 'object' || Array.isArray(mapped)) {
    return true
  }

  const channels = mapped as Record<string, unknown>
  return channels[channel] !== false
}

const hasMarketingConsent = ({
  user,
  options,
}: {
  user: Record<string, unknown>
  options: NormalizedNotificationsPluginOptions
}): boolean => {
  const mapped = getNestedValue(user, options.preferences.fields.marketingConsent)
  return mapped !== false
}

/**
 * With `preferences.mandatoryInUserFields`, channel opt-outs never block mandatory mail (order, delivery, refund updates):
 * explicitly transactional sends while `transactional` is mandatory, or any send
 * whose category is listed in `preferences.mandatoryCategories`.
 */
const isMandatorySend = (
  options: NormalizedNotificationsPluginOptions,
  input: NotificationSendInput,
  category?: string,
) => {
  if (!options.preferences.mandatoryInUserFields) return false
  const mandatory = options.preferences.mandatoryCategories
  if (category && mandatory.includes(category)) return true
  return input.classification === 'transactional' && mandatory.includes('transactional')
}

export const evaluateNotificationPolicy = async ({
  user,
  input,
  options,
  category,
}: {
  user: Record<string, unknown>
  input: NotificationSendInput
  options: NormalizedNotificationsPluginOptions
  /** Delivery category (trigger category, else classification). */
  category?: string
}): Promise<NotificationPolicyDecision> => {
  if (
    !isMandatorySend(options, input, category) &&
    !isChannelEnabledForUser({ user, channel: input.channel, options })
  ) {
    return {
      allow: false,
      reason: `User opted out of ${input.channel} notifications`,
    }
  }

  if (input.classification === 'marketing') {
    if (!hasMarketingConsent({ user, options })) {
      return {
        allow: false,
        reason: 'User has not consented to marketing notifications',
      }
    }
  }

  if (options.policy.canSend) {
    const policyResult = await options.policy.canSend({
      channel: input.channel,
      event: input.event,
      classification: input.classification,
      user,
      payload: input.eventPayload,
    })

    if (!policyResult.allow) {
      return {
        allow: false,
        reason: policyResult.reason || 'Notification delivery blocked by policy',
      }
    }
  }

  return {
    allow: true,
  }
}
