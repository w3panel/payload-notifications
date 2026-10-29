import type {
  NormalizedNotificationsPluginOptions,
  NotificationChannel,
  RenderedNotificationContent,
  SmsSegmentInfo,
} from '../types'
import { renderTemplate as renderEngineTemplate } from './engine'

const GSM_BASIC =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà'
const GSM_EXTENDED = '^{}\\[~]|€\f'
const BASIC = new Set(GSM_BASIC)
const EXTENDED = new Set(GSM_EXTENDED)

/**
 * SMS sizing: GSM-7 when every character is in the GSM alphabet (extension
 * characters count twice), otherwise UCS-2. Single messages hold 160 / 70
 * characters; concatenated segments hold 153 / 67.
 */
export const smsSegments = (text: string): SmsSegmentInfo => {
  const chars = [...text]
  const gsm = chars.every((char) => BASIC.has(char) || EXTENDED.has(char))
  if (gsm) {
    const characters = chars.reduce((total, char) => total + (EXTENDED.has(char) ? 2 : 1), 0)
    return {
      encoding: 'GSM-7',
      characters,
      segments: characters <= 160 ? 1 : Math.ceil(characters / 153),
    }
  }
  // UCS-2 counts UTF-16 code units (emoji take two).
  const characters = text.length
  return {
    encoding: 'UCS-2',
    characters,
    segments: characters <= 70 ? 1 : Math.ceil(characters / 67),
  }
}

const SAFE_SCHEME = /^(https?:|mailto:|tel:|sms:|#|\/|\{\{)/i
const HREF = /\b(href|src)\s*=\s*(["'])(.*?)\2/gi

/** Link / image URLs in HTML that use an unsafe scheme (javascript:, data:, vbscript:, …). */
export const findUnsafeLinks = (html: string): string[] => {
  const unsafe: string[] = []
  for (const match of html.matchAll(HREF)) {
    const url = match[3].trim()
    if (url && !SAFE_SCHEME.test(url) && /^[a-z][a-z0-9+.-]*:/i.test(url)) unsafe.push(url)
  }
  return unsafe
}

/** Replaces unsafe link / image URLs with `#` (defence in depth at render time). */
export const sanitizeLinks = (html: string): string =>
  html.replace(HREF, (whole, attr: string, quote: string, url: string) => {
    const value = url.trim()
    return value && !SAFE_SCHEME.test(value) && /^[a-z][a-z0-9+.-]*:/i.test(value)
      ? `${attr}=${quote}#${quote}`
      : whole
  })

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`)

/** Hidden inbox preview text placed at the top of the HTML body. */
export const preheaderHtml = (preheader: string) =>
  `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all">${escapeHtml(preheader)}</div>`

const URL_PATTERN = /https?:\/\/[^\s<>"')]+/g

/** Runs `shorten` on every URL in plain text. */
export const shortenLinksInText = async (
  text: string,
  shorten: (url: string) => string | Promise<string>,
): Promise<string> => {
  const urls = [...new Set(text.match(URL_PATTERN) ?? [])]
  let result = text
  for (const url of urls) {
    const short = await shorten(url)
    if (short && short !== url) result = result.split(url).join(short)
  }
  return result
}

/**
 * Channel-specific finishing after rendering:
 * - email: sanitize links, add the preheader, wrap in `templates.emailLayout`
 * - sms / whatsapp: shorten links (`templates.shortenLink`), count segments
 */
export const finalizeForChannel = async (
  rendered: RenderedNotificationContent,
  channel: NotificationChannel,
  options: Pick<NormalizedNotificationsPluginOptions, 'templates'>,
): Promise<RenderedNotificationContent> => {
  if (channel === 'email') {
    let html = sanitizeLinks(rendered.html)
    const layout = options.templates.emailLayout
    if (typeof layout === 'function') {
      html = layout({ html, subject: rendered.subject, preheader: rendered.preheader })
    } else if (typeof layout === 'string') {
      html = renderEngineTemplate(layout, {
        content: html,
        subject: rendered.subject ?? '',
        preheader: rendered.preheader ?? '',
      })
    }
    if (rendered.preheader) {
      html = html.includes('<body')
        ? html.replace(/<body([^>]*)>/i, (tag) => `${tag}${preheaderHtml(rendered.preheader!)}`)
        : `${preheaderHtml(rendered.preheader)}${html}`
    }
    return { ...rendered, html }
  }

  if (channel === 'sms' || channel === 'whatsapp') {
    const shorten = options.templates.shortenLink
    const body = shorten ? await shortenLinksInText(rendered.body, shorten) : rendered.body
    return { ...rendered, body, text: body, segments: smsSegments(body) }
  }

  return rendered
}
