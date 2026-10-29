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
      preheader?: string
    }
    const textBody = email.textBody || ''
    const htmlBody = email.htmlBody || ''
    return {
      subject: email.subject,
      body: textBody || htmlBody || '',
      textBody: textBody || undefined,
      htmlBody: htmlBody || undefined,
      ...(email.preheader ? { preheader: email.preheader } : {}),
    }
  }

  if (channel === 'sms') {
    const sms = (doc.sms || {}) as { body?: string }
    return { body: sms.body || '' }
  }

  if (channel === 'whatsapp') {
    const whatsapp = (doc.whatsapp || {}) as {
      body?: string
      hsmTemplateId?: string
      hsmLanguage?: string
      hsmParameters?: Array<{ value?: string }>
    }
    return {
      body: whatsapp.body || '',
      ...(whatsapp.hsmTemplateId
        ? {
            whatsappTemplate: {
              name: whatsapp.hsmTemplateId,
              language: whatsapp.hsmLanguage || 'en',
              parameters: (whatsapp.hsmParameters ?? []).map((parameter) => parameter?.value ?? ''),
            },
          }
        : {}),
    }
  }

  if (channel === 'inapp') {
    const inapp = (doc.inapp || {}) as {
      title?: string
      body?: string
      actionUrl?: string
      icon?: string
      priority?: 'low' | 'normal' | 'high' | 'urgent'
    }
    return {
      title: inapp.title,
      body: inapp.body || '',
      ...(inapp.actionUrl ? { actionUrl: inapp.actionUrl } : {}),
      ...(inapp.icon ? { icon: inapp.icon } : {}),
      ...(inapp.priority ? { priority: inapp.priority } : {}),
    }
  }

  return { body: '' }
}
