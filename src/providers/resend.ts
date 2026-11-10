import type { NotificationProvider, ProviderStatusUpdate } from '../types'
import { ProviderError, kindForStatus } from './errors'

export type ResendEmailProviderOptions = {
  apiKey: string
  /** Default sender, e.g. `Electrofit <orders@electrofit.ae>`. */
  from: string
  replyTo?: string
  /** Defaults to https://api.resend.com */
  baseUrl?: string
  /** For tests or custom runtimes. Defaults to global fetch. */
  fetch?: typeof fetch
}

const MAX_KEY_LENGTH = 256

/** Resend accepts keys up to 256 characters; longer ones are hashed. */
export const resendIdempotencyKey = async (key: string): Promise<string> => {
  if (key.length <= MAX_KEY_LENGTH) return key
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(key))
  return `sha256:${Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')}`
}

type ResendError = { statusCode?: number; name?: string; message?: string }

const readJson = async (response: Response): Promise<Record<string, unknown> | undefined> => {
  const text = await response.text()
  if (!text) return undefined
  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    return { message: text.slice(0, 300) }
  }
}

const STATUS_BY_EVENT: Record<string, ProviderStatusUpdate['status']> = {
  sent: 'sent',
  delivered: 'delivered',
  opened: 'read',
  clicked: 'read',
  bounced: 'failed',
  complained: 'failed',
  failed: 'failed',
}

/**
 * Email through the Resend REST API, with the delivery's idempotency key as
 * Resend's `Idempotency-Key`. Resend drops a repeat of the same key for 24 hours,
 * so timeouts and 5xx responses are retried instead of being left `unknown`.
 * Uses `fetch` only, so it runs on Workers, Vercel and Node.
 */
export const createResendEmailProvider = ({
  apiKey,
  from,
  replyTo,
  baseUrl = 'https://api.resend.com',
  fetch: fetchImpl,
}: ResendEmailProviderOptions): NotificationProvider => {
  const request = (path: string, init: RequestInit) =>
    (fetchImpl ?? globalThis.fetch)(`${baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        ...(init.headers as Record<string, string> | undefined),
      },
    })

  return {
    name: 'resend',
    channels: ['email'],
    capabilities: { html: true, hsm: false, media: false, idempotent: true },
    validateConfig: () => [
      ...(apiKey ? [] : ['Resend apiKey is missing']),
      ...(from ? [] : ['Resend from address is missing']),
    ],
    send: async ({ to, content, headers, idempotencyKey, signal }) => {
      const response = await request('/emails', {
        method: 'POST',
        signal,
        headers: idempotencyKey
          ? { 'Idempotency-Key': await resendIdempotencyKey(idempotencyKey) }
          : undefined,
        body: JSON.stringify({
          from,
          to: [to],
          subject: content.subject || 'Notification',
          html: content.html || undefined,
          text: content.text || content.body,
          ...(replyTo ? { reply_to: replyTo } : {}),
          ...(headers && Object.keys(headers).length ? { headers } : {}),
        }),
      })
      const data = (await readJson(response)) as (ResendError & { id?: string }) | undefined
      if (response.ok && data?.id) {
        return { status: 'accepted', providerMessageId: data.id }
      }
      const status = data?.statusCode ?? response.status
      const message = `Resend ${status}: ${data?.name ?? 'error'} - ${data?.message ?? response.statusText}`
      // Same key still in flight: try again shortly. Same key, different body: never.
      if (status === 409) {
        throw new ProviderError(message, {
          status,
          code: data?.name,
          kind: data?.name === 'concurrent_idempotent_requests' ? 'retryable' : 'permanent',
        })
      }
      throw new ProviderError(message, { status, code: data?.name, kind: kindForStatus(status) })
    },
    getStatus: async (providerMessageId) => {
      const response = await request(`/emails/${encodeURIComponent(providerMessageId)}`, {
        method: 'GET',
      })
      if (!response.ok) return undefined
      const data = (await readJson(response)) as { last_event?: string } | undefined
      const status = data?.last_event ? STATUS_BY_EVENT[data.last_event] : undefined
      if (!status) return undefined
      return {
        providerMessageId,
        status,
        ...(data?.last_event === 'bounced' || data?.last_event === 'complained'
          ? { suppress: true, error: `Email ${data.last_event}` }
          : {}),
      }
    },
  }
}
