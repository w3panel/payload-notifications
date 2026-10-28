import type {
  NotificationChannel,
  NotificationTemplateDefinition,
  NotificationTemplateRecord,
} from '../types'

type LooseTemplateDoc = Partial<NotificationTemplateRecord> & Record<string, unknown>

/**
 * Build a channel template definition from a notification-templates document (draft or active).
 */
export const buildDefinitionFromTemplateDoc = (
  doc: LooseTemplateDoc,
  channel: NotificationChannel,
): NotificationTemplateDefinition => {
  if (channel === 'email') {
    const email = (doc.email || {}) as {
      subject?: string
      htmlBody?: string
      textBody?: string
    }
    const textBody = email.textBody || ''
    const htmlBody = email.htmlBody || ''
    return {
      subject: email.subject,
      body: textBody || htmlBody || '',
      textBody: textBody || undefined,
      htmlBody: htmlBody || undefined,
    }
  }

  if (channel === 'sms') {
    const sms = (doc.sms || {}) as { body?: string }
    return { body: sms.body || '' }
  }

  if (channel === 'whatsapp') {
    const whatsapp = (doc.whatsapp || {}) as { body?: string }
    return { body: whatsapp.body || '' }
  }

  if (channel === 'inapp') {
    const inapp = (doc.inapp || {}) as { title?: string; body?: string }
    return {
      title: inapp.title,
      body: inapp.body || '',
    }
  }

  return { body: '' }
}
