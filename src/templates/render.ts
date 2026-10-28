import type { NotificationTemplateContext, NotificationTemplateRenderer } from '../types'
import { renderDefinition } from './renderDefinition'

/**
 * Legacy string renderer. Prefer {@link renderDefinition} on the send path so
 * subject/title from template definitions are preserved.
 */
export const renderTemplate: NotificationTemplateRenderer = async (template, context) => {
  const rendered = renderDefinition({ body: template }, context)

  return {
    subject: rendered.subject || `Notification: ${context.event}`,
    text: rendered.text,
    html: rendered.html,
    meta: {
      template,
    },
  }
}

export const buildTemplateContext = (
  context: NotificationTemplateContext,
): NotificationTemplateContext => context
