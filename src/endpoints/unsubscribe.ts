import type { Endpoint, Payload, PayloadRequest } from 'payload'
import type { NormalizedNotificationsPluginOptions } from '../types'
import {
  signUnsubscribeToken,
  UNSUBSCRIBE_PATH,
  verifyUnsubscribeToken,
  type UnsubscribeClaims,
} from '../policy/unsubscribe'

/** Public unsubscribe URL for a user and category, or undefined when unsubscribe is not configured. */
export const buildUnsubscribeUrl = async (
  payload: Payload,
  options: NormalizedNotificationsPluginOptions,
  claims: UnsubscribeClaims,
): Promise<string | undefined> => {
  const config = options.preferences.unsubscribe
  if (!config) return undefined
  const base = (config.baseUrl || payload.config?.serverURL || '').replace(/\/$/, '')
  const api = payload.config?.routes?.api || '/api'
  const token = await signUnsubscribeToken(config.secret, claims)
  return `${base}${api}${UNSUBSCRIBE_PATH}?token=${encodeURIComponent(token)}`
}

const html = (title: string, body: string, status = 200) =>
  new Response(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head><body style="font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem">${body}</body></html>`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  )

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`)

/** Records an opt-out preference (upsert on user × channel × category). */
export const recordOptOut = async (
  payload: Payload,
  options: NormalizedNotificationsPluginOptions,
  claims: UnsubscribeClaims,
  source = 'unsubscribe-link',
) => {
  const channel = claims.ch || '*'
  const collection = options.collections.preferences as never
  const existing = await payload.find({
    collection,
    where: {
      and: [
        { user: { equals: claims.u } },
        { category: { equals: claims.c } },
        { channel: { equals: channel } },
      ],
    },
    limit: 1,
    depth: 0,
    overrideAccess: true,
    pagination: false,
  })
  const data = { enabled: false, consentAt: new Date().toISOString(), consentSource: source }
  const current = existing.docs?.[0] as { id: string | number } | undefined
  if (current) {
    await payload.update({ collection, id: current.id, data: data as never, overrideAccess: true })
  } else {
    await payload.create({
      collection,
      data: { user: claims.u, category: claims.c, channel, ...data } as never,
      overrideAccess: true,
    })
  }
}

const tokenFrom = async (req: PayloadRequest): Promise<string | undefined> => {
  const url = new URL(req.url || 'http://localhost')
  const fromQuery = url.searchParams.get('token')
  if (fromQuery) return fromQuery
  if (req.method?.toUpperCase() === 'POST') {
    try {
      const form = new URLSearchParams(await req.text?.())
      return form.get('token') || undefined
    } catch {
      return undefined
    }
  }
  return undefined
}

/**
 * `GET /api/payload-notifications/unsubscribe?token=…` shows a confirmation
 * page; `POST` (form or RFC 8058 one-click) records the opt-out.
 */
export const unsubscribeEndpoints = (
  getOptions: () => NormalizedNotificationsPluginOptions,
): Endpoint[] => {
  const handler = async (req: PayloadRequest) => {
    const options = getOptions()
    const secret = options.preferences.unsubscribe?.secret
    if (!secret) return html('Unavailable', '<p>Unsubscribe links are not enabled.</p>', 404)

    const token = await tokenFrom(req)
    const claims = token ? await verifyUnsubscribeToken(secret, token) : undefined
    if (!token || !claims)
      return html(
        'Invalid link',
        '<p>This unsubscribe link is invalid or has been altered.</p>',
        400,
      )

    const label = escapeHtml(claims.c)
    if (req.method?.toUpperCase() !== 'POST') {
      return html(
        'Unsubscribe',
        `<h1>Unsubscribe</h1><p>Stop receiving <strong>${label}</strong> notifications?</p><form method="post"><input type="hidden" name="token" value="${escapeHtml(token)}"><button type="submit">Unsubscribe</button></form>`,
      )
    }
    await recordOptOut(req.payload, options, claims)
    return html(
      'Unsubscribed',
      `<h1>You're unsubscribed</h1><p>You will no longer receive <strong>${label}</strong> notifications.</p>`,
    )
  }
  return [
    { path: UNSUBSCRIBE_PATH, method: 'get', handler },
    { path: UNSUBSCRIBE_PATH, method: 'post', handler },
  ]
}
