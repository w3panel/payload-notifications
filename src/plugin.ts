import type { Config, Payload } from 'payload'
import type { CollectionConfig } from 'payload'
import type {
  AdminTriggerRecord,
  NormalizedNotificationsPluginOptions,
  NotificationQueueTask,
  NotificationsPluginOptions,
} from './types'
import type { PayloadRequest, TaskConfig, TaskHandler, TaskHandlerResult } from 'payload'

type TaskFailArgs = {
  input?: object
  job: { id?: string | number; error?: unknown }
  req: PayloadRequest
}
import {
  NotificationsCollection,
  type NotificationsCollectionOverrides,
} from './collections/Notifications'
import {
  NotificationLogsCollection,
  type NotificationLogsCollectionOverrides,
} from './collections/NotificationLogs'
import {
  NotificationDeliveriesCollection,
  type NotificationDeliveriesCollectionOverrides,
} from './collections/NotificationDeliveries'
import {
  NotificationTemplatesCollection,
  type NotificationTemplatesCollectionOverrides,
} from './collections/NotificationTemplates'
import { normalizePluginOptions, validateNormalizedOptions } from './config/normalizePluginOptions'
import { PLUGIN_CUSTOM_KEY, type PluginCustomConfig } from './config/runtime'
import { dataSourcesListEndpoint } from './endpoints/dataSources'
import { eventsListEndpoint } from './endpoints/events'
import { validateDataAllowlist } from './data/sources'
import { injectCollectionEventHooks, validateCollectionEvents } from './events/collectionEvents'
import { setEventDepth } from './events/depth'
import { NOTIFICATION_PROCESS_EVENT_TASK, NOTIFICATION_SEND_TASK } from './jobs/constants'
import { assertNotificationEvent, emitNotificationEvent, processEvent } from './jobs/processEvent'
import { assertNotificationSendInput, sendNotification } from './jobs/sendNotification'
import {
  processEventInputSchema,
  sendNotificationInputSchema,
  sendNotificationOutputSchema,
} from './jobs/taskSchemas'
import { writeNotificationLog } from './jobs/writeLog'
import { markDeliveryFailed } from './deliveries/send'
import { buildDeliveryFingerprint, createObservabilityEvent } from './reliability'
import { seedTemplatesFromRegistry } from './templates/seed'
import { collectTriggerWarnings } from './triggers/validate'

const hasCollectionSlug = (collections: CollectionConfig[] = [], slug: string): boolean => {
  return collections.some((collection) => collection.slug === slug)
}

const getExistingTaskSlugs = (config: Config): string[] => {
  const jobsConfig = config.jobs
  if (!jobsConfig || !('tasks' in jobsConfig) || !Array.isArray(jobsConfig.tasks)) {
    return []
  }

  return jobsConfig.tasks
    .map((task) => (task && typeof task === 'object' && 'slug' in task ? String(task.slug) : ''))
    .filter(Boolean)
}

/**
 * Holds a mutable reference that is populated by onInit once the Payload
 * instance is available. Task handlers close over this so they work out of
 * the box without host-app wiring.
 */
type RuntimeRef = {
  payload: Payload | null
  options: NormalizedNotificationsPluginOptions
  /** Published admin-created triggers, loaded from `notification-triggers` (Phase 4). */
  adminTriggers: AdminTriggerRecord[]
}

const createSendOnFail =
  (runtime: RuntimeRef) =>
  async ({ input, job, req }: TaskFailArgs) => {
    const options = runtime.options
    const payload = req.payload || runtime.payload
    if (!payload || !input || typeof input !== 'object') return

    try {
      const sendInput = assertNotificationSendInput(input)
      const fingerprint = buildDeliveryFingerprint(sendInput)
      const reason =
        typeof job.error === 'object' && job.error && 'message' in job.error
          ? String((job.error as { message?: unknown }).message || 'Notification send failed')
          : 'Notification send failed after retries'

      if (sendInput.deliveryId) {
        await markDeliveryFailed({
          payload,
          options,
          deliveryId: sendInput.deliveryId,
          reason,
        })
      }

      await writeNotificationLog({
        payload,
        options,
        input: { ...sendInput, jobId: job.id },
        status: 'failed',
        error: reason,
        fingerprint,
        failureClassification: 'terminal',
      })

      if (options.observability.onDispatch) {
        await options.observability.onDispatch(
          createObservabilityEvent({
            input: sendInput,
            result: {
              channel: sendInput.channel,
              status: 'failed',
              reason,
            },
            fingerprint,
            classification: 'terminal',
          }),
        )
      }
    } catch {
      // Best-effort terminal failure logging
    }
  }

const createLiveTaskHandler = (
  taskSlug: typeof NOTIFICATION_PROCESS_EVENT_TASK | typeof NOTIFICATION_SEND_TASK,
  runtime: RuntimeRef,
): TaskHandler<any> => {
  return async ({ input, job, req }) => {
    const payload = req?.payload || runtime.payload
    if (!payload) {
      throw new Error(
        `payload-notifications: task ${taskSlug} cannot run before plugin initialization`,
      )
    }

    if (taskSlug === NOTIFICATION_PROCESS_EVENT_TASK) {
      const event = assertNotificationEvent(input)
      // Writes made while processing (e.g. by resolvers using this req) are one level deeper.
      setEventDepth(req, (event.depth ?? 0) + 1)
      await processEvent({
        payload,
        event,
        options: runtime.options,
        adminTriggers: runtime.adminTriggers,
        req,
      })
      return { output: {} } as TaskHandlerResult<any>
    }

    const sendInput = assertNotificationSendInput({
      ...(typeof input === 'object' && input ? input : {}),
      jobId: job?.id,
    })
    const result = await sendNotification({
      payload,
      input: sendInput,
      options: runtime.options,
    })
    return { output: result ?? {} } as TaskHandlerResult<any>
  }
}

const buildProcessEventTask = (runtime: RuntimeRef): TaskConfig<any> => ({
  slug: NOTIFICATION_PROCESS_EVENT_TASK,
  label: 'Process notification event',
  interfaceName: 'NotificationProcessEventTask',
  inputSchema: processEventInputSchema,
  retries: 0,
  handler: createLiveTaskHandler(NOTIFICATION_PROCESS_EVENT_TASK, runtime),
})

const buildSendTask = (runtime: RuntimeRef): TaskConfig<any> => ({
  slug: NOTIFICATION_SEND_TASK,
  label: 'Send notification',
  interfaceName: 'NotificationSendTask',
  inputSchema: sendNotificationInputSchema,
  outputSchema: sendNotificationOutputSchema,
  retries: {
    attempts: 2,
    backoff: { type: 'exponential', delay: 5000 },
  },
  concurrency: ({ input, queue }) => {
    if (typeof input?.deliveryId === 'string' && input.deliveryId) {
      return `${queue}::delivery::${input.deliveryId}`
    }
    const userId = typeof input?.userId === 'string' ? input.userId : 'unknown'
    const channel = typeof input?.channel === 'string' ? input.channel : 'unknown'
    const event = typeof input?.event === 'string' ? input.event : 'unknown'
    const template = typeof input?.template === 'string' ? input.template : 'unknown'
    const idempotencyKey =
      typeof input?.idempotencyKey === 'string' ? input.idempotencyKey : 'no-idempotency-key'
    return `${queue}::${userId}::${channel}::${event}::${template}::${idempotencyKey}`
  },
  onFail: createSendOnFail(runtime),
  handler: createLiveTaskHandler(NOTIFICATION_SEND_TASK, runtime),
})

const registerTaskDefinitions = (
  config: Config,
  tasks: NotificationQueueTask[],
  runtime: RuntimeRef,
): TaskConfig<any>[] => {
  const existing = new Set(getExistingTaskSlugs(config))
  const nextTasks: TaskConfig<any>[] =
    config.jobs && 'tasks' in config.jobs && Array.isArray(config.jobs.tasks)
      ? [...(config.jobs.tasks as TaskConfig<any>[])]
      : []

  const builders: Record<string, () => TaskConfig<any>> = {
    [NOTIFICATION_PROCESS_EVENT_TASK]: () => buildProcessEventTask(runtime),
    [NOTIFICATION_SEND_TASK]: () => buildSendTask(runtime),
  }

  for (const task of tasks) {
    if (existing.has(task.slug)) continue
    const builder = builders[task.slug]
    nextTasks.push(
      builder
        ? builder()
        : ({ slug: task.slug, handler: async () => ({ output: {} }) } as TaskConfig<any>),
    )
    existing.add(task.slug)
  }

  return nextTasks
}

export const notificationsPlugin = (options: NotificationsPluginOptions = {}) => {
  const normalizedOptions = normalizePluginOptions(options)
  validateNormalizedOptions(normalizedOptions)

  const runtime: RuntimeRef = { payload: null, options: normalizedOptions, adminTriggers: [] }

  return (config: Config): Config => {
    if (normalizedOptions.enabled === false) {
      return config
    }

    const collections = [...(config.collections || [])]
    const withCollections = registerCollections(
      collections,
      normalizedOptions,
      undefined,
      () => runtime.options,
    )
    const allowlistErrors = [
      ...validateDataAllowlist(withCollections, normalizedOptions.data.collections),
      ...validateCollectionEvents(withCollections, normalizedOptions),
    ]
    if (allowlistErrors.length) {
      throw new Error(
        `payload-notifications: invalid configuration\n  - ${allowlistErrors.join('\n  - ')}`,
      )
    }

    const tasks = registerTaskDefinitions(
      config,
      [{ slug: NOTIFICATION_PROCESS_EVENT_TASK }, { slug: NOTIFICATION_SEND_TASK }],
      runtime,
    )

    const existingOnInit = config.onInit

    const custom: PluginCustomConfig = { getOptions: () => runtime.options }

    return {
      ...config,
      custom: {
        ...config.custom,
        [PLUGIN_CUSTOM_KEY]: custom,
      },
      endpoints: [
        ...(config.endpoints || []),
        eventsListEndpoint(() => runtime.options),
        dataSourcesListEndpoint(() => runtime.options),
      ],
      collections: injectCollectionEventHooks(
        withCollections,
        () => runtime.options,
        ({ event, req }) =>
          emitNotificationEvent({
            payload: req.payload,
            event,
            req,
            options: runtime.options,
          }).then(() => undefined),
      ),
      jobs: {
        ...config.jobs,
        tasks,
      },
      onInit: async (payload: Payload) => {
        runtime.payload = payload
        for (const warning of collectTriggerWarnings(runtime.options)) {
          payload.logger?.warn?.(`payload-notifications: ${warning}`)
        }
        if (runtime.options.templates.seedOnInit) {
          try {
            await seedTemplatesFromRegistry({ payload, options: runtime.options })
          } catch (error) {
            payload.logger?.error?.(
              error instanceof Error
                ? error.message
                : 'payload-notifications: template seedOnInit failed',
            )
          }
        }
        if (existingOnInit) {
          await existingOnInit(payload)
        }
      },
    }
  }
}

export const registerCollections = (
  collections: CollectionConfig[],
  options: NormalizedNotificationsPluginOptions,
  overrides?: {
    notifications?: NotificationsCollectionOverrides
    logs?: NotificationLogsCollectionOverrides
    templates?: NotificationTemplatesCollectionOverrides
    deliveries?: NotificationDeliveriesCollectionOverrides
  },
  getOptions?: () => NormalizedNotificationsPluginOptions,
): CollectionConfig[] => {
  const next = [...collections]

  if (!hasCollectionSlug(next, options.collections.notifications)) {
    next.push(
      NotificationsCollection({
        userCollectionSlug: options.userCollectionSlug,
        slug: options.collections.notifications,
        overrides: overrides?.notifications,
      }),
    )
  }

  if (!hasCollectionSlug(next, options.collections.logs)) {
    next.push(
      NotificationLogsCollection({
        userCollectionSlug: options.userCollectionSlug,
        slug: options.collections.logs,
        overrides: overrides?.logs,
      }),
    )
  }

  if (!hasCollectionSlug(next, options.collections.templates)) {
    next.push(
      NotificationTemplatesCollection({
        slug: options.collections.templates,
        overrides: overrides?.templates,
        getOptions: getOptions || (() => options),
      }),
    )
  }

  if (!hasCollectionSlug(next, options.collections.deliveries)) {
    next.push(
      NotificationDeliveriesCollection({
        slug: options.collections.deliveries,
        overrides: overrides?.deliveries,
      }),
    )
  }

  return next
}

/**
 * Public API for registering notification task definitions.
 * Uses a standalone runtime ref — tasks registered this way will need
 * `createTaskHandlers()` to execute. For automatic handler wiring,
 * use `notificationsPlugin()` which sets up handlers via onInit.
 */
export const registerNotificationTasks = (
  config: Config,
  tasks: NotificationQueueTask[],
): TaskConfig<any>[] => {
  const standaloneRuntime: RuntimeRef = {
    payload: null,
    options: normalizePluginOptions(),
    adminTriggers: [],
  }
  return registerTaskDefinitions(config, tasks, standaloneRuntime)
}

export const createTaskHandlers = (
  payload: Payload,
  options: NormalizedNotificationsPluginOptions,
) => {
  return {
    [NOTIFICATION_PROCESS_EVENT_TASK]: async ({ input }: { input?: unknown }) => {
      const event = assertNotificationEvent(input)
      await processEvent({ payload, event, options })
    },
    [NOTIFICATION_SEND_TASK]: async ({ input }: { input?: unknown }) => {
      const sendInput = assertNotificationSendInput(input)
      return sendNotification({ payload, input: sendInput, options })
    },
  }
}
