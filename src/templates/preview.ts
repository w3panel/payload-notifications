import type {
  NotificationChannel,
  NotificationTemplateContext,
  RenderedNotificationContent,
} from '../types'
import { buildDefinitionFromTemplateDoc } from './fromDoc'
import { renderDefinition } from './renderDefinition'

export type PreviewTemplateInput = {
  doc: Record<string, unknown>
  channel: NotificationChannel
  context: NotificationTemplateContext
}

/**
 * Render a template document (including unsaved draft field values) for admin preview.
 */
export const previewTemplateDoc = ({
  doc,
  channel,
  context,
}: PreviewTemplateInput): RenderedNotificationContent => {
  const definition = buildDefinitionFromTemplateDoc(doc, channel)
  if (!definition.body && !definition.htmlBody && !definition.whatsappTemplate) {
    throw new Error(`payload-notifications: no ${channel} content to preview`)
  }
  return renderDefinition(definition, context)
}
