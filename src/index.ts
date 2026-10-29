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
  CollectionEventConfig,
  CollectionEventOperation,
  NormalizedCollectionEventConfig,
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
  NotificationAccessCheck,
  NotificationTemplateContext,
  NotificationTemplateDefinition,
  NotificationTemplateRecord,
  NotificationTemplateRegistry,
  NotificationTemplateRenderer,
  NotificationTemplateResolution,
  NotificationTemplateResolver,
  NotificationTemplateSet,
  NotificationTriggerDefinition,
  AdminTriggerRecord,
  EffectiveTrigger,
  NotificationDeliveryDefinition,
  NotificationTrigger,
  NotificationTriggerInput,
  TriggerAdminPolicy,
  TriggerCollectionSource,
  TriggerEventSource,
  TriggerOrigin,
  TriggerOverridableField,
  TriggerSource,
  ConditionDefinition,
  ConditionHandler,
  ConditionOperator,
  CustomCondition,
  FieldCondition,
  NotificationCondition,
  NotificationDuration,
  NotificationSchedule,
  NotificationScheduleOptions,
  ContextRecipient,
  EventUserRecipient,
  NotificationRecipientDefinition,
  NotificationRecipientQueryDefinition,
  NotificationRecipientResolverDefinition,
  NotificationRecipientsOptions,
  QueryRecipient,
  RecipientDestinations,
  RecipientResolverResult,
  ResolvedRecipient,
  ResolverRecipient,
  RoleRecipient,
  StaticRecipient,
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
export {
  DELIVERY_STATUSES,
  NotificationDeliveriesCollection,
} from './collections/NotificationDeliveries'
export type { NotificationDeliveriesCollectionOverrides } from './collections/NotificationDeliveries'
export {
  EVENT_INBOX_STATUSES,
  NotificationEventsCollection,
} from './collections/NotificationEvents'
export type { NotificationEventsCollectionOverrides } from './collections/NotificationEvents'
export { findInboxRecord, replayNotificationEvent } from './events/inbox'
export {
  NotificationTriggersCollection,
  TRIGGER_STATUSES,
} from './collections/NotificationTriggers'
export type { NotificationTriggersCollectionOverrides } from './collections/NotificationTriggers'
export { NotificationTriggerVersionsCollection } from './collections/NotificationTriggerVersions'
export { definitionOf, DEFINITION_FIELDS, toAdminTriggerRecord } from './admin-triggers/record'
export type { TriggerDefinitionFields } from './admin-triggers/record'
export { effectiveTriggerFor, validateAdminTrigger } from './admin-triggers/validate'
export type { TriggerValidationReport } from './admin-triggers/validate'
export {
  cancelQueuedDeliveries,
  LIFECYCLE_ACTIONS,
  runLifecycleAction,
  triggerLifecycleEndpoint,
} from './admin-triggers/lifecycle'
export type { LifecycleAction, LifecycleResult } from './admin-triggers/lifecycle'
export { createAdminTriggerCache, loadPublishedAdminTriggers } from './admin-triggers/store'
export {
  adminTriggerRootEndpoints,
  codeTriggersEndpoint,
  customizeCodeTriggerEndpoint,
  triggerRegistryEndpoint,
  triggerTestEndpoint,
} from './admin-triggers/endpoints'
export { evaluateTriggerPlan, recipientScopeOf } from './deliveries/evaluate'
export type { RecipientScope, TriggerPlan, TriggerPlanItem } from './deliveries/evaluate'
export type { AdminTriggerCache } from './admin-triggers/store'
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
export {
  checkTriggerShape,
  defineTrigger,
  isValidEventPattern,
  ruleSlug,
  ruleToTrigger,
} from './triggers'
export {
  compileCodeTriggers,
  eventMatchesPattern,
  matchTriggers,
  OVERRIDABLE_FIELDS,
  resolveEffectiveTriggers,
  snapshotTrigger,
  collectTriggerWarnings,
  validateTrigger,
  collectConditionRefs,
  CONDITION_OPERATORS,
  conditionNeedsData,
  evaluateCondition,
  previousPathFor,
  validateCondition,
} from './triggers'
export type {
  EffectiveTriggersResult,
  TriggerMatchInput,
  TriggerSnapshot,
  TriggerValidationResult,
  ConditionValidationContext,
  EvaluateConditionArgs,
} from './triggers'
export {
  DEFAULT_RECIPIENTS,
  maskDestination,
  normalizeEmail,
  normalizePhone,
  recipientAlias,
  resolveRecipients,
  validateRecipientDefinitions,
} from './recipients'
export type { ResolveRecipientsArgs, ResolveRecipientsResult } from './recipients'
export { buildDeliveryKey, planDeliveries } from './deliveries/plan'
export type { DeliveryPlanResult, PlannedDelivery } from './deliveries/plan'
export { FINAL_DELIVERY_STATUSES, markDeliveryFailed, sendDelivery } from './deliveries/send'
export { dispatchToChannel } from './channels/dispatch'
export {
  applyQuietHours,
  computeSchedule,
  isValidTimeZone,
  parseClock,
  parseDuration,
} from './deliveries/schedule'
export type { ScheduleResult } from './deliveries/schedule'
export { recheckDelivery } from './deliveries/recheck'
export type { RecheckDelivery, RecheckResult } from './deliveries/recheck'
export {
  collectFieldPaths,
  listRegisteredEvents,
  prepareNotificationEvent,
  validateEventPayload,
} from './events/registry'
export { EVENT_NAME_PATTERN, isValidEventName } from './events/names'
export {
  buildCollectionEvent,
  collectionEventName,
  createCollectionEventHooks,
  injectCollectionEventHooks,
  validateCollectionEvents,
} from './events/collectionEvents'
export type { QueueCollectionEvent } from './events/collectionEvents'
export {
  DEFAULT_MAX_EVENT_DEPTH,
  EVENT_DEPTH_CONTEXT_KEY,
  getEventDepth,
  setEventDepth,
} from './events/depth'
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
