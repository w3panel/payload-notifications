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

export type PreviewSampleChoice =
  | { kind: 'json' }
  | { kind: 'event' }
  | { kind: 'document'; collection: string; id: string }
  | { kind: 'trigger'; trigger: string; documentId?: string }

/** Request body for the preview endpoint. */
export const buildPreviewBody = ({
  channel,
  doc,
  contextJson,
  sample,
}: {
  channel: NotificationChannel
  doc: Record<string, unknown>
  contextJson: string
  sample: PreviewSampleChoice
}): { ok: true; body: Record<string, unknown> } | { ok: false; error: string } => {
  if (sample.kind === 'json') {
    const parsed = parsePreviewContext(contextJson)
    return parsed.ok
      ? { ok: true, body: { channel, doc, context: parsed.value } }
      : { ok: false, error: parsed.error }
  }
  if (sample.kind === 'document' && (!sample.collection.trim() || !sample.id.trim())) {
    return { ok: false, error: 'Enter a collection and document ID' }
  }
  if (sample.kind === 'trigger' && !sample.trigger.trim()) {
    return { ok: false, error: 'Enter a trigger slug' }
  }
  const choice =
    sample.kind === 'document'
      ? { kind: 'document', collection: sample.collection.trim(), id: sample.id.trim() }
      : sample.kind === 'trigger'
        ? {
            kind: 'trigger',
            trigger: sample.trigger.trim(),
            ...(sample.documentId?.trim() ? { documentId: sample.documentId.trim() } : {}),
          }
        : { kind: 'event' }
  return { ok: true, body: { channel, doc, sample: choice } }
}

/** Dark-mode simulation: inverts colours like clients that force dark mode, keeping images. */
export const DARK_MODE_CSS =
  'html{filter:invert(1) hue-rotate(180deg);background:#fff}img,picture,video,[style*="background-image"]{filter:invert(1) hue-rotate(180deg)}'

/** HTML for the preview iframe (optionally with the dark-mode simulation). */
export const previewSrcDoc = (html: string, { dark = false }: { dark?: boolean } = {}): string => {
  if (!dark) return html
  const style = `<style>${DARK_MODE_CSS}</style>`
  return /<\/head>/i.test(html) ? html.replace(/<\/head>/i, `${style}</head>`) : `${style}${html}`
}

export const PREVIEW_WIDTHS = { desktop: 680, mobile: 375 } as const
