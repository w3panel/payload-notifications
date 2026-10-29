import type { Config, Endpoint, Payload, PayloadRequest } from 'payload'
import type { NormalizedNotificationsPluginOptions, NotificationChannel } from '../types'
import { resolveProvider } from '../providers/builtin'
import { META_GRAPH_API_VERSION } from '../providers/meta-whatsapp'
import { denyUnless } from './access'

type Credential = { name: string; set: boolean }

export type ProviderStatus = {
  channel: NotificationChannel
  provider: string | null
  source: 'custom' | 'builtin' | 'none'
  capabilities?: Record<string, unknown>
  /** Configuration problems (never secret values). */
  problems: string[]
  /** Which credentials are set, by option name. */
  credentials: Credential[]
  webhookUrl?: string
}

const set = (name: string, value: unknown): Credential => ({
  name,
  set: typeof value === 'string' ? value.trim().length > 0 : Boolean(value),
})

const credentialsFor = (
  channel: NotificationChannel,
  options: NormalizedNotificationsPluginOptions,
): Credential[] => {
  if (channel === 'sms' && options.providers.sms?.provider === 'twilio') {
    const sms = options.providers.sms
    return [
      set('providers.sms.accountSid', sms.accountSid),
      set('providers.sms.authToken', sms.authToken),
      set('providers.sms.from', sms.from),
    ]
  }
  if (channel === 'whatsapp') {
    const whatsapp = options.providers.whatsapp
    if (whatsapp?.provider === 'meta') {
      return [
        set('providers.whatsapp.accessToken', whatsapp.accessToken),
        set('providers.whatsapp.phoneNumberId', whatsapp.phoneNumberId),
      ]
    }
    if (whatsapp?.provider === 'twilio') {
      return [
        set('providers.whatsapp.accountSid', whatsapp.accountSid),
        set('providers.whatsapp.authToken', whatsapp.authToken),
        set('providers.whatsapp.from', whatsapp.from),
      ]
    }
  }
  return []
}

const webhookBase = (
  options: NormalizedNotificationsPluginOptions,
  config?: Pick<Config, 'serverURL' | 'routes'>,
) => {
  const origin = (options.webhooks.publicUrl || config?.serverURL || '').replace(/\/$/, '')
  const api = config?.routes?.api ?? '/api'
  return origin ? `${origin}${api}/payload-notifications/webhooks` : undefined
}

/** Provider configuration status for a channel. Secrets are reported as set / missing only. */
export const providerStatus = (
  channel: NotificationChannel,
  options: NormalizedNotificationsPluginOptions,
  config?: Pick<Config, 'serverURL' | 'routes'>,
): ProviderStatus => {
  const custom = options.providers.custom[channel]
  const credentials = credentialsFor(channel, options)
  let provider
  const problems: string[] = []
  try {
    provider = resolveProvider(channel, options)
  } catch (error) {
    problems.push(error instanceof Error ? error.message : String(error))
  }
  if (!provider && !problems.length && channel !== 'push') {
    problems.push(`No provider configured for ${channel} (providers.${channel})`)
  }
  problems.push(
    ...credentials.filter((entry) => !entry.set).map((entry) => `${entry.name} is not set`),
  )
  try {
    problems.push(...(provider?.validateConfig?.() ?? []))
  } catch (error) {
    problems.push(error instanceof Error ? error.message : String(error))
  }
  const base = webhookBase(options, config)
  const webhookUrl =
    base &&
    (channel === 'sms' || channel === 'whatsapp') &&
    (custom
      ? `${base}/provider/${channel}`
      : provider?.name === 'meta'
        ? `${base}/meta`
        : provider?.name === 'twilio'
          ? `${base}/twilio`
          : undefined)
  return {
    channel,
    provider: provider?.name ?? null,
    source: custom ? 'custom' : provider ? 'builtin' : 'none',
    ...(provider ? { capabilities: { ...provider.capabilities } } : {}),
    problems: [...new Set(problems)],
    credentials,
    ...(webhookUrl ? { webhookUrl } : {}),
  }
}

/** Read-only settings for the admin (everything here is defined in code). */
export const settingsSnapshot = (
  options: NormalizedNotificationsPluginOptions,
  config?: Pick<Config, 'serverURL' | 'routes'>,
) => ({
  channels: options.channels,
  providers: options.channels.map((channel) => providerStatus(channel, options, config)),
  providerTimeoutMs: options.providers.timeoutMs,
  jobs: { queue: options.jobs.queue },
  reliability: {
    attempts: options.reliability.attempts,
    maxAttempts: options.reliability.maxAttempts,
    backoff: options.reliability.backoff,
    jitter: options.reliability.jitter,
    staleSendingMinutes: options.reliability.staleSendingMinutes,
  },
  maintenance: {
    reconcileCron: options.maintenance.reconcileCron ?? null,
    retentionCron: options.maintenance.retentionCron ?? null,
    retention: options.maintenance.retention,
  },
  eventsInbox: options.eventsInbox,
  preferences: {
    mode: options.preferences.mode,
    mandatoryCategories: options.preferences.mandatoryCategories,
    marketingRequiresOptIn: options.preferences.marketingRequiresOptIn,
    unsubscribeLinks: Boolean(options.preferences.unsubscribe?.secret),
  },
  quietHours: options.quietHours ?? null,
  tenancy: options.tenancy ?? null,
  webhooks: {
    baseUrl: webhookBase(options, config) ?? null,
    twilioSignature: Boolean(options.webhooks.twilio?.authToken),
    metaSignature: Boolean(options.webhooks.meta?.appSecret),
  },
  logs: { storeRendered: options.logs.storeRendered },
})

const withTimeout = (ms: number) =>
  typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal
    ? AbortSignal.timeout(ms)
    : undefined

/** Checks a provider's credentials without sending a message. */
export const testProviderConnection = async (
  channel: NotificationChannel,
  options: NormalizedNotificationsPluginOptions,
  payload: Payload,
  fetcher: typeof fetch = fetch,
): Promise<{ ok: boolean; message: string }> => {
  const status = providerStatus(channel, options)
  if (status.source === 'none') return { ok: false, message: status.problems.join('; ') }
  const provider = resolveProvider(channel, options)
  if (provider?.testConnection) return provider.testConnection()
  if (status.problems.length) return { ok: false, message: status.problems.join('; ') }

  const signal = withTimeout(options.providers.timeoutMs)
  const call = async (
    url: string,
    headers: Record<string, string>,
    describe: (body: Record<string, unknown>) => string,
  ) => {
    try {
      const res = await fetcher(url, { headers, signal })
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
      if (res.ok) return { ok: true, message: describe(body) }
      const error = body.error as { message?: unknown } | undefined
      return {
        ok: false,
        message:
          `${res.status} ${String(error?.message ?? body.message ?? res.statusText ?? '')}`.trim(),
      }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  }

  if (status.source === 'builtin' && status.provider === 'twilio') {
    const config = channel === 'sms' ? options.providers.sms : options.providers.whatsapp
    const auth = btoa(`${config?.accountSid}:${config?.authToken}`)
    return call(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(String(config?.accountSid))}.json`,
      { Authorization: `Basic ${auth}` },
      (body) =>
        `Twilio account ${String(body.friendly_name ?? '')} (${String(body.status ?? 'ok')})`,
    )
  }
  if (status.source === 'builtin' && status.provider === 'meta') {
    const whatsapp = options.providers.whatsapp
    return call(
      `https://graph.facebook.com/${META_GRAPH_API_VERSION}/${encodeURIComponent(String(whatsapp?.phoneNumberId))}?fields=display_phone_number,verified_name,quality_rating`,
      { Authorization: `Bearer ${whatsapp?.accessToken}` },
      (body) =>
        `WhatsApp number ${String(body.display_phone_number ?? '')} (${String(body.verified_name ?? '')}${body.quality_rating ? `, quality ${String(body.quality_rating)}` : ''})`,
    )
  }
  if (channel === 'email') {
    const adapter = (payload as unknown as { email?: { name?: string } }).email
    const name = adapter?.name
    if (!adapter || !name) return { ok: false, message: 'Payload has no email adapter configured' }
    if (name === 'console') {
      return {
        ok: false,
        message: 'Payload uses the console email adapter; emails are only logged',
      }
    }
    return { ok: true, message: `Payload email adapter "${name}" is configured` }
  }
  if (channel === 'inapp')
    return { ok: true, message: 'In-app notifications are stored in Payload' }
  return { ok: true, message: 'No connection test for this provider; configuration checks passed' }
}

/**
 * `GET /api/payload-notifications/settings` (viewDeliveries) and
 * `POST /api/payload-notifications/providers/:channel/test` (testSend).
 */
export const settingsEndpoints = (
  getOptions: () => NormalizedNotificationsPluginOptions,
): Endpoint[] => [
  {
    path: '/payload-notifications/settings',
    method: 'get',
    handler: async (req: PayloadRequest) => {
      const options = getOptions()
      const denied = await denyUnless(req, options.access.viewDeliveries)
      if (denied) return denied
      return Response.json(settingsSnapshot(options, req.payload.config))
    },
  },
  {
    path: '/payload-notifications/providers/:channel/test',
    method: 'post',
    handler: async (req: PayloadRequest) => {
      const options = getOptions()
      const denied = await denyUnless(req, options.access.testSend)
      if (denied) return denied
      const channel = String(req.routeParams?.channel ?? '') as NotificationChannel
      if (!options.channels.includes(channel)) {
        return Response.json({ error: `Channel "${channel}" is not enabled` }, { status: 400 })
      }
      return Response.json(await testProviderConnection(channel, options, req.payload))
    },
  },
]
