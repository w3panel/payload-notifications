import type { Endpoint, PayloadRequest } from 'payload'
import type {
  NormalizedNotificationsPluginOptions,
  NotificationChannel,
  NotificationProvider,
  ProviderWebhookRequest,
  ProviderWebhookResult,
} from '../types'
import { applyWebhookResult } from './apply'
import { parseMetaWebhook, parseTwilioWebhook } from './providers'

const WEBHOOK_BASE = '/payload-notifications/webhooks'

/** The request as a provider sees it; the URL uses `webhooks.publicUrl` behind proxies. */
export const toWebhookRequest = async (
  req: PayloadRequest,
  options: NormalizedNotificationsPluginOptions,
): Promise<ProviderWebhookRequest> => {
  const url = new URL(req.url || 'http://localhost')
  const publicUrl = options.webhooks.publicUrl
    ? `${options.webhooks.publicUrl.replace(/\/$/, '')}${url.pathname}${url.search}`
    : url.toString()
  const method = req.method?.toUpperCase() ?? 'POST'
  return {
    method,
    url: publicUrl,
    headers: req.headers,
    rawBody: method === 'GET' ? '' : ((await req.text?.()) ?? ''),
    query: url.searchParams,
  }
}

const respond = async (
  req: PayloadRequest,
  options: NormalizedNotificationsPluginOptions,
  result: ProviderWebhookResult,
  channel?: NotificationChannel,
) => {
  if (!result.verified) return new Response('Invalid signature', { status: 403 })
  if (result.response) {
    return new Response(result.response.body, {
      status: result.response.status,
      headers: { 'Content-Type': result.response.contentType ?? 'text/plain' },
    })
  }
  const summary = await applyWebhookResult(req.payload, options, result, channel)
  return Response.json({ ok: true, ...summary })
}

const twilioAuthToken = (options: NormalizedNotificationsPluginOptions) =>
  options.webhooks.twilio?.authToken ??
  (options.providers.sms?.provider === 'twilio' ? options.providers.sms.authToken : undefined) ??
  (options.providers.whatsapp?.provider === 'twilio'
    ? options.providers.whatsapp.authToken
    : undefined)

/**
 * Webhook endpoints:
 * - `POST /api/payload-notifications/webhooks/twilio` (status callbacks, STOP replies)
 * - `GET|POST /api/payload-notifications/webhooks/meta` (verification, statuses, replies)
 * - `GET|POST /api/payload-notifications/webhooks/provider/:channel` (custom providers' parseWebhook)
 */
export const webhookEndpoints = (
  getOptions: () => NormalizedNotificationsPluginOptions,
): Endpoint[] => {
  const twilio = async (req: PayloadRequest) => {
    const options = getOptions()
    const authToken = twilioAuthToken(options)
    if (!authToken) return new Response('Twilio webhooks are not configured', { status: 404 })
    return respond(
      req,
      options,
      await parseTwilioWebhook(await toWebhookRequest(req, options), authToken),
    )
  }

  const meta = async (req: PayloadRequest) => {
    const options = getOptions()
    const config = options.webhooks.meta
    if (!config) return new Response('Meta webhooks are not configured', { status: 404 })
    return respond(
      req,
      options,
      await parseMetaWebhook(await toWebhookRequest(req, options), config),
      'whatsapp',
    )
  }

  const custom = async (req: PayloadRequest) => {
    const options = getOptions()
    const channel = String(req.routeParams?.channel ?? '') as NotificationChannel
    const provider: NotificationProvider | undefined = options.providers.custom[channel]
    if (!provider?.parseWebhook) return new Response('No webhook for this channel', { status: 404 })
    return respond(
      req,
      options,
      await provider.parseWebhook(await toWebhookRequest(req, options)),
      channel,
    )
  }

  return [
    { path: `${WEBHOOK_BASE}/twilio`, method: 'post', handler: twilio },
    { path: `${WEBHOOK_BASE}/meta`, method: 'get', handler: meta },
    { path: `${WEBHOOK_BASE}/meta`, method: 'post', handler: meta },
    { path: `${WEBHOOK_BASE}/provider/:channel`, method: 'get', handler: custom },
    { path: `${WEBHOOK_BASE}/provider/:channel`, method: 'post', handler: custom },
  ]
}
