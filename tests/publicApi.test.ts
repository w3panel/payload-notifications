import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import * as api from '../src/index'

/** Public surface as of 0.3.2. New exports may be added; none of these may disappear. */
const RUNTIME_EXPORTS_0_3_2 = [
  'NOTIFICATIONS_JOB_QUEUE',
  'NOTIFICATION_PROCESS_EVENT_TASK',
  'NOTIFICATION_SEND_TASK',
  'NotificationLogsCollection',
  'NotificationTemplatesCollection',
  'NotificationsCollection',
  'assertNotificationEvent',
  'assertNotificationSendInput',
  'buildCommonEventContext',
  'buildDefinitionFromTemplateDoc',
  'buildDeliveryFingerprint',
  'buildNotificationMetaField',
  'buildProviderResponseField',
  'buildTemplateContext',
  'classifyDispatchFailure',
  'compileTemplate',
  'createMetaWhatsAppProvider',
  'createObservabilityEvent',
  'createSMSProvider',
  'createTaskHandlers',
  'createTwilioSMSProvider',
  'createTwilioWhatsAppProvider',
  'createWhatsAppProvider',
  'defineTrigger',
  'emitNotificationEvent',
  'evaluateNotificationPolicy',
  'getContextValue',
  'mergeTemplateDefinition',
  'normalizePluginOptions',
  'notificationsPlugin',
  'previewTemplateDoc',
  'processEvent',
  'queueNotificationSend',
  'registerCollections',
  'registerNotificationTasks',
  'renderCompiledTemplate',
  'renderDefinition',
  'renderEngineTemplate',
  'renderTemplate',
  'resolveRulesForEvent',
  'resolveTemplate',
  'resolveTemplateSync',
  'seedTemplatesFromRegistry',
  'sendNotification',
  'validateNormalizedOptions',
  'writeNotificationLog',
]

const TYPE_EXPORTS_0_3_2 = [
  'ChannelProviderResult',
  'CompileOptions',
  'CompiledTemplate',
  'DispatchFailureClassification',
  'DispatchFailureInfo',
  'EmailProviderConfig',
  'NormalizedNotificationsPluginOptions',
  'NotificationChannel',
  'NotificationClassification',
  'NotificationDispatchResult',
  'NotificationDispatchStatus',
  'NotificationEvent',
  'NotificationEventPayload',
  'NotificationLogsCollectionOverrides',
  'NotificationPolicyContext',
  'NotificationPolicyDecision',
  'NotificationProcessEventJobInput',
  'NotificationQueueTask',
  'NotificationRule',
  'NotificationSendInput',
  'NotificationSendJobInput',
  'NotificationTemplateContext',
  'NotificationTemplateDefinition',
  'NotificationTemplateRecord',
  'NotificationTemplateRegistry',
  'NotificationTemplateRenderer',
  'NotificationTemplateResolution',
  'NotificationTemplateResolver',
  'NotificationTemplateSet',
  'NotificationTemplatesCollectionOverrides',
  'NotificationTriggerDefinition',
  'NotificationsCollectionOverrides',
  'NotificationsJobsOptions',
  'NotificationsPluginOptions',
  'ObservabilityEvent',
  'PreferenceFieldMapping',
  'RenderedNotificationContent',
  'RenderedTemplate',
  'SMSProviderAdapter',
  'SMSProviderConfig',
  'SMSProviderSendInput',
  'SeedTemplatesResult',
  'TemplateNode',
  'WhatsAppProviderAdapter',
  'WhatsAppProviderConfig',
  'WhatsAppProviderSendInput',
]

const exportedTypeNames = (): Set<string> => {
  const source = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8')
  const names = new Set<string>()
  for (const block of source.matchAll(/export type \{([^}]*)\}/g)) {
    for (const name of block[1].split(',')) {
      const trimmed = name.trim()
      if (trimmed) names.add(trimmed)
    }
  }
  return names
}

describe('public API', () => {
  it('keeps every 0.3.2 runtime export', () => {
    const exported = Object.keys(api)
    for (const name of RUNTIME_EXPORTS_0_3_2) expect(exported).toContain(name)
  })

  it('keeps every 0.3.2 type export', () => {
    const exported = exportedTypeNames()
    for (const name of TYPE_EXPORTS_0_3_2) expect(exported.has(name)).toBe(true)
  })
})
