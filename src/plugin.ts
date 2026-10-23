import type { Config, Payload } from 'payload'
import type { CollectionConfig } from 'payload'
import type {
  NormalizedNotificationsPluginOptions,
  NotificationQueueTask,
  NotificationsPluginOptions,
} from './types'
import type { TaskConfig, TaskHandler, TaskHandlerResult } from 'payload'
import {
  NotificationsCollection,
  type NotificationsCollectionOverrides,
} from './collections/Notifications'
import {
  NotificationLogsCollection,
  type NotificationLogsCollectionOverrides,
} from './collections/NotificationLogs'
import {
  NotificationTemplatesCollection,
  type NotificationTemplatesCollectionOverrides,
} from './collections/NotificationTemplates'
import { normalizePluginOptions, validateNormalizedOptions } from './config/normalizePluginOptions'
import { assertNotificationEvent, processEvent } from './jobs/processEvent'
import { assertNotificationSendInput, sendNotification } from './jobs/sendNotification'

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
}

const createLiveTaskHandler = (
  taskSlug: 'notification:process-event' | 'notification:send',
  runtime: RuntimeRef,
): TaskHandler<any> => {
  return async ({ input }: { input?: unknown }) => {
    if (!runtime.payload) {
      throw new Error(
        `payload-notifications: task ${taskSlug} cannot run before plugin initialization`,
      )
    }

    if (taskSlug === 'notification:process-event') {
      const event = assertNotificationEvent(input)
      await processEvent({ payload: runtime.payload, event, options: runtime.options })
      return { output: {} } as TaskHandlerResult<any>
    }

    const sendInput = assertNotificationSendInput(input)
    const result = await sendNotification({
      payload: runtime.payload,
      input: sendInput,
      options: runtime.options,
    })
    return { output: result ?? {} } as TaskHandlerResult<any>
  }
}

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

  for (const task of tasks) {
    if (existing.has(task.slug)) continue

    nextTasks.push({
      slug: task.slug,
      handler: createLiveTaskHandler(task.slug, runtime),
    } as TaskConfig<any>)

    existing.add(task.slug)
  }

  return nextTasks
}

export const notificationsPlugin = (options: NotificationsPluginOptions = {}) => {
  const normalizedOptions = normalizePluginOptions(options)
  validateNormalizedOptions(normalizedOptions)

  const runtime: RuntimeRef = { payload: null, options: normalizedOptions }

  return (config: Config): Config => {
    if (normalizedOptions.enabled === false) {
      return config
    }

    const collections = [...(config.collections || [])]
    const withCollections = registerCollections(collections, normalizedOptions)
    const tasks = registerTaskDefinitions(
      config,
      [{ slug: 'notification:process-event' }, { slug: 'notification:send' }],
      runtime,
    )

    const existingOnInit = config.onInit

    return {
      ...config,
      collections: withCollections,
      jobs: {
        ...config.jobs,
        tasks,
      },
      onInit: async (payload: Payload) => {
        runtime.payload = payload
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
  },
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
  }
  return registerTaskDefinitions(config, tasks, standaloneRuntime)
}

export const createTaskHandlers = (
  payload: Payload,
  options: NormalizedNotificationsPluginOptions,
) => {
  return {
    'notification:process-event': async ({ input }: { input?: unknown }) => {
      const event = assertNotificationEvent(input)
      await processEvent({ payload, event, options })
    },
    'notification:send': async ({ input }: { input?: unknown }) => {
      const sendInput = assertNotificationSendInput(input)
      return sendNotification({ payload, input: sendInput, options })
    },
  }
}
