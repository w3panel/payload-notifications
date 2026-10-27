import type { NotificationChannel } from '../types'

export const DEFAULT_PREVIEW_CONTEXT = `{
  "event": "order.paid",
  "userId": "user_1",
  "payload": {
    "orderId": "ORD-1001",
    "trackingNumber": "TRACK-42",
    "url": "https://example.com/magic"
  }
}`

export const CHANNEL_OPTIONS: NotificationChannel[] = ['email', 'inapp', 'sms', 'whatsapp']

export const parsePreviewContext = (
  raw: string,
): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } => {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, error: 'Context must be a JSON object' }
    }
    return { ok: true, value: parsed as Record<string, unknown> }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Invalid JSON',
    }
  }
}

export const buildTemplateApiPath = (
  collectionSlug: string,
  action: 'preview' | 'test-send',
  apiRoute = '/api',
): string => {
  const base = apiRoute.replace(/\/$/, '')
  return `${base}/${collectionSlug}/${action}`
}
