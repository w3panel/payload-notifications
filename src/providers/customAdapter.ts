import type { Payload } from 'payload'
import type {
  ChannelProviderResult,
  NormalizedNotificationsPluginOptions,
  NotificationProvider,
} from '../types'

/**
 * Exposes a v2 provider through the v1 text-adapter shape used by the legacy
 * (non-delivery) send path, so `providers.custom` applies there too.
 */
export const customAsAdapter = (
  provider: NotificationProvider,
  payload: Payload | undefined,
  channel: 'sms' | 'whatsapp',
  options: NormalizedNotificationsPluginOptions,
) => ({
  send: async (input: { to: string; template: string }): Promise<ChannelProviderResult> => {
    const result = await provider.send({
      to: input.to,
      channel,
      content: { body: input.template, text: input.template, html: '' },
      signal: new AbortController().signal,
      payload: payload as Payload,
      options,
    })
    return {
      provider: provider.name,
      messageId: result.providerMessageId,
      response: result.response,
    }
  },
})
