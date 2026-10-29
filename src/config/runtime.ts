import type { Payload } from 'payload'
import type { NormalizedNotificationsPluginOptions } from '../types'

/** Key under Payload's server-only `config.custom` where the plugin exposes its live options. */
export const PLUGIN_CUSTOM_KEY = 'payloadNotifications'

export type PluginCustomConfig = {
  getOptions: () => NormalizedNotificationsPluginOptions
}

/**
 * Live plugin options for helpers called with only a Payload instance
 * (e.g. `emitNotificationEvent`). Undefined when the plugin is not installed.
 */
export const getRuntimeOptions = (
  payload: Pick<Payload, 'config'> | undefined,
): NormalizedNotificationsPluginOptions | undefined => {
  const custom = (payload?.config as { custom?: Record<string, unknown> } | undefined)?.custom
  const entry = custom?.[PLUGIN_CUSTOM_KEY] as Partial<PluginCustomConfig> | undefined
  return typeof entry?.getOptions === 'function' ? entry.getOptions() : undefined
}
