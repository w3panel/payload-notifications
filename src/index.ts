export {
  createTaskHandlers,
  notificationsPlugin,
  registerCollections,
  registerNotificationTasks,
} from './plugin'
export { normalizePluginOptions, validateNormalizedOptions } from './config/normalizePluginOptions'
export type {
  ChannelProviderResult,
  CollectionDataSource,
  ComputedDataSource,
  DataCollectionAllowlist,
  DataContextResult,
  DataSourceLookup,
  DocumentDataSource,
  EventDataSource,
  NotificationDataConfig,
  NotificationDataContext,
  NotificationComputedDefinition,
  NotificationComputedHandler,
  NotificationComputedRegistry,
  NotificationDataResolverDefinition,
  NotificationDataResolverHandler,
  NotificationDataResolverRegistry,
  NotificationResolverArgs,
  RegisteredDataFunction,
  NotificationDataSource,
  NotificationsDataOptions,
  ResolverDataSource,
  EmailProviderConfig,
  NormalizedNotificationsPluginOptions,
  NotificationChannel,
  NotificationClassification,
  NotificationDispatchResult,
  NotificationDispatchStatus,
  NotificationEvent,
  NotificationEventDefinition,
  NotificationEventPayload,
  NotificationEventRegistry,
  NotificationEventSchema,
  NotificationEventValidator,
  NotificationPolicyContext,
  NotificationPolicyDecision,
  NotificationProcessEventJobInput,
  NotificationQueueTask,
  NotificationRule,
  NotificationSendInput,
  NotificationSendJobInput,
  NotificationsPluginOptions,
  NotificationTemplateContext,
  NotificationTemplateDefinition,
  NotificationTemplateRecord,
  NotificationTemplateRegistry,
  NotificationTemplateRenderer,
  NotificationTemplateResolution,
  NotificationTemplateResolver,
  NotificationTemplateSet,
  NotificationTriggerDefinition,
  NotificationTriggerInfo,
  NotificationsJobsOptions,
  PreferenceFieldMapping,
  RenderedNotificationContent,
  RegisteredNotificationEvent,
  RenderedTemplate,
  SMSProviderAdapter,
  StandardSchemaV1Like,
  SMSProviderConfig,
  SMSProviderSendInput,
  WhatsAppProviderAdapter,
  WhatsAppProviderConfig,
  WhatsAppProviderSendInput,
} from './types'
export { NotificationsCollection, buildNotificationMetaField } from './collections/Notifications'
export type { NotificationsCollectionOverrides } from './collections/Notifications'
export {
  NotificationLogsCollection,
  buildProviderResponseField,
} from './collections/NotificationLogs'
export type { NotificationLogsCollectionOverrides } from './collections/NotificationLogs'
export { NotificationTemplatesCollection } from './collections/NotificationTemplates'
export type { NotificationTemplatesCollectionOverrides } from './collections/NotificationTemplates'
export {
  NOTIFICATION_PROCESS_EVENT_TASK,
  NOTIFICATION_SEND_TASK,
  NOTIFICATIONS_JOB_QUEUE,
} from './jobs/constants'
export {
  assertNotificationEvent,
  emitNotificationEvent,
  processEvent,
  resolveRulesForEvent,
} from './jobs/processEvent'
export {
  assertNotificationSendInput,
  queueNotificationSend,
  sendNotification,
} from './jobs/sendNotification'
export { writeNotificationLog } from './jobs/writeLog'
export { evaluateNotificationPolicy } from './policy/evaluatePolicy'
export { createSMSProvider } from './providers/sms'
export { createWhatsAppProvider } from './providers/whatsapp'
export { createMetaWhatsAppProvider } from './providers/meta-whatsapp'
export { createTwilioWhatsAppProvider } from './providers/twilio-whatsapp'
export { createTwilioSMSProvider } from './providers/twilio-sms'
export type {
  DispatchFailureClassification,
  DispatchFailureInfo,
  ObservabilityEvent,
} from './reliability'
export {
  buildDeliveryFingerprint,
  classifyDispatchFailure,
  createObservabilityEvent,
} from './reliability'
export { buildCommonEventContext, buildTemplateContext, getContextValue } from './templates/context'
export { renderTemplate } from './templates/render'
export { mergeTemplateDefinition, renderDefinition } from './templates/renderDefinition'
export { buildDefinitionFromTemplateDoc } from './templates/fromDoc'
export { previewTemplateDoc } from './templates/preview'
export { resolveTemplate, resolveTemplateSync } from './templates/resolve'
export { seedTemplatesFromRegistry } from './templates/seed'
export type { SeedTemplatesResult } from './templates/seed'
export {
  compile as compileTemplate,
  render as renderCompiledTemplate,
  renderTemplate as renderEngineTemplate,
} from './templates/engine'
export type { CompiledTemplate, CompileOptions, TemplateNode } from './templates/engine'
export { defineTrigger } from './triggers'
export {
  collectFieldPaths,
  listRegisteredEvents,
  prepareNotificationEvent,
  validateEventPayload,
} from './events/registry'
export { EVENT_NAME_PATTERN, isValidEventName } from './events/names'
export { getRuntimeOptions } from './config/runtime'
export { eventsListEndpoint } from './endpoints/events'
export {
  assertValidDataSources,
  collectCollectionFieldPaths,
  orderDataSources,
  RESERVED_ALIASES,
  validateDataAllowlist,
  validateDataSources,
} from './data/sources'
export type { DataSourceValidationContext } from './data/sources'
export { buildDataContext } from './data/buildContext'
export type { BuildDataContextArgs } from './data/buildContext'
export { getPath, pickPaths, toRelationId, toSelect } from './data/paths'
export {
  DEFAULT_RESOLVER_TIMEOUT_MS,
  listDataFunctions,
  ResolverError,
  runComputed,
  runDataResolver,
} from './data/resolvers'
export type { ResolverErrorKind } from './data/resolvers'
export { dataSourcesListEndpoint } from './endpoints/dataSources'
export {
  createSensitiveFieldMatcher,
  isSensitivePath,
  REDACTED,
  redactContext,
  SENSITIVE_FIELD_NAMES,
  SENSITIVE_FIELD_PATTERNS,
  stripSensitiveFields,
} from './data/sensitive'
export type { SensitiveFieldMatcher } from './data/sensitive'
