import type {
  NotificationTemplateContext,
  NotificationTemplateDefinition,
  RenderedNotificationContent,
} from '../types'
import { renderTemplate as renderEngineTemplate } from './engine'

const escapeHtml = (value: string): string => {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const toEngineContext = (context: NotificationTemplateContext): Record<string, unknown> => ({
  ...context,
  payload: context.payload ?? {},
})

/**
 * Convert `{{ path }}` to `{{{ path }}}` so channel text (SMS/email text) stays unescaped.
 * Existing triple-brace expressions are left alone. HTML callers escape separately.
 */
const toRawInterpolationSource = (source: string): string => {
  return source.replace(/\{\{\{([\s\S]*?)\}\}\}|\{\{([\s\S]*?)\}\}/g, (match, triple, double) => {
    if (triple !== undefined) return match
    return `{{{ ${String(double).trim()} }}}`
  })
}

const renderPlainText = (source: string, context: NotificationTemplateContext): string => {
  return renderEngineTemplate(toRawInterpolationSource(source), toEngineContext(context))
}

/**
 * Resolve subject/title/body tokens for a template definition using the Handlebars-subset engine.
 * - Plain text channels use unescaped interpolation.
 * - When `htmlBody` is set, it is rendered with HTML-escaping of interpolated values (use `{{{ }}}` for raw).
 * - Otherwise `html` is an escaped `<p>` wrapper around the text body.
 */
export const renderDefinition = (
  definition: NotificationTemplateDefinition,
  context: NotificationTemplateContext,
): RenderedNotificationContent => {
  const textSource = definition.textBody || definition.body
  const body = renderPlainText(textSource, context)
  const subject = definition.subject ? renderPlainText(definition.subject, context) : undefined
  const title = definition.title ? renderPlainText(definition.title, context) : undefined

  const html = definition.htmlBody
    ? renderEngineTemplate(definition.htmlBody, toEngineContext(context))
    : `<p>${escapeHtml(body)}</p>`

  return {
    subject,
    title,
    body,
    text: body,
    html,
  }
}

export const mergeTemplateDefinition = (
  definition: NotificationTemplateDefinition,
  overrides?: Partial<NotificationTemplateDefinition>,
): NotificationTemplateDefinition => {
  if (!overrides) return definition

  return {
    ...definition,
    ...overrides,
    body: overrides.body ?? definition.body,
  }
}
