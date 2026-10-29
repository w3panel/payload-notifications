import { describe, expect, it, mock } from 'bun:test'
import {
  createTaskHandlers,
  notificationsPlugin,
  registerCollections,
  registerNotificationTasks,
} from '../src/plugin'
import { normalizePluginOptions } from '../src/config/normalizePluginOptions'

describe('payload-notifications', () => {
  it('exports notificationsPlugin function', () => {
    expect(typeof notificationsPlugin).toBe('function')
  })

  it('returns a config transformer', () => {
    const plugin = notificationsPlugin({ enabled: true })
    expect(typeof plugin).toBe('function')
  })

  it('registers collections once', () => {
    const options = normalizePluginOptions()
    const collections = registerCollections([], options)
    const secondPass = registerCollections(collections, options)

    expect(collections).toHaveLength(3)
    expect(secondPass).toHaveLength(3)
  })

  it('respects custom collection slugs', () => {
    const options = normalizePluginOptions({
      collections: {
        notifications: 'app-notifications',
        logs: 'app-notification-logs',
      },
    })

    const collections = registerCollections([], options)
    expect(collections[0]?.slug).toBe('app-notifications')
    expect(collections[1]?.slug).toBe('app-notification-logs')
  })

  it('allows collection overrides during registration', () => {
    const options = normalizePluginOptions()
    const collections = registerCollections([], options, {
      notifications: {
        admin: {
          useAsTitle: 'message',
        },
      },
    })

    expect(collections[0]?.admin?.useAsTitle).toBe('message')
  })

  it('registers notification tasks once', () => {
    const first = registerNotificationTasks({}, [
      { slug: 'notification:process-event' },
      { slug: 'notification:send' },
    ])

    const second = registerNotificationTasks(
      {
        jobs: {
          tasks: first,
        },
      },
      [{ slug: 'notification:process-event' }, { slug: 'notification:send' }],
    )

    expect(first).toHaveLength(2)
    expect(second).toHaveLength(2)
  })

  it('adds collections and tasks through plugin transformer', () => {
    const plugin = notificationsPlugin()
    // Payload 3 needs the flag for the send task's concurrency key.
    const config = plugin({ collections: [], jobs: { enableConcurrencyControl: true } as never })

    expect(config.collections).toHaveLength(3)
    const tasks = config.jobs && 'tasks' in config.jobs ? (config.jobs.tasks as any[]) : []
    expect(tasks).toHaveLength(2)

    const sendTask = tasks.find((task) => task.slug === 'notification:send')
    expect(sendTask?.retries?.attempts).toBe(2)
    expect(sendTask?.retries?.backoff?.type).toBe('exponential')
    expect(sendTask?.inputSchema?.length).toBeGreaterThan(0)
    expect(sendTask?.outputSchema?.length).toBeGreaterThan(0)
    expect(typeof sendTask?.onFail).toBe('function')
    expect(typeof sendTask?.concurrency).toBe('function')

    const processTask = tasks.find((task) => task.slug === 'notification:process-event')
    expect(processTask?.retries).toBe(0)
    expect(processTask?.inputSchema?.length).toBeGreaterThan(0)
  })

  it('creates runnable task handlers for process-event and send', async () => {
    const queue = mock(async () => undefined)
    const create = mock(async () => undefined)
    const findByID = mock(async () => ({ id: 'user_1', email: 'demo@example.com' }))
    const sendEmail = mock(async () => undefined)

    const payload = {
      jobs: { queue },
      create,
      findByID,
      sendEmail,
    }

    const handlers = createTaskHandlers(
      payload as never,
      normalizePluginOptions({
        rules: [
          {
            event: 'order.paid',
            channels: ['email'],
            template: 'order.paid',
          },
        ],
      }),
    )

    await handlers['notification:process-event']({
      input: {
        name: 'order.paid',
        userId: 'user_1',
      },
    })

    await handlers['notification:send']({
      input: {
        userId: 'user_1',
        channel: 'email',
        template: 'order.paid',
        event: 'order.paid',
      },
    })

    expect(queue).toHaveBeenCalledTimes(1)
    expect(sendEmail).toHaveBeenCalledTimes(1)
  })

  it('registers live task handlers that work after onInit', async () => {
    const queue = mock(async () => undefined)
    const create = mock(async () => undefined)
    const findByID = mock(async () => ({ id: 'user_1', email: 'demo@example.com' }))
    const sendEmail = mock(async () => undefined)

    const mockPayload = {
      jobs: { queue },
      create,
      findByID,
      sendEmail,
    }

    const plugin = notificationsPlugin({
      rules: [
        {
          event: 'order.paid',
          channels: ['email'],
          template: 'order.paid',
        },
      ],
    })

    const config = plugin({ collections: [] })
    const tasks = config.jobs && 'tasks' in config.jobs ? (config.jobs.tasks as any[]) : []

    const processEventTask = tasks.find((t: any) => t.slug === 'notification:process-event')
    const sendTask = tasks.find((t: any) => t.slug === 'notification:send')

    expect(processEventTask).toBeTruthy()
    expect(sendTask).toBeTruthy()

    // Simulate Payload calling onInit
    await config.onInit?.(mockPayload as never)

    // Task handlers should now work without the deferred error
    await processEventTask.handler({
      input: { name: 'order.paid', userId: 'user_1' },
    })

    expect(queue).toHaveBeenCalledTimes(1)

    await sendTask.handler({
      input: {
        userId: 'user_1',
        channel: 'email',
        template: 'order.paid',
        event: 'order.paid',
      },
    })

    expect(sendEmail).toHaveBeenCalledTimes(1)
  })

  it('task handlers fail gracefully before onInit', async () => {
    const plugin = notificationsPlugin()
    const config = plugin({ collections: [] })
    const tasks = config.jobs && 'tasks' in config.jobs ? (config.jobs.tasks as any[]) : []

    const processEventTask = tasks.find((t: any) => t.slug === 'notification:process-event')

    await expect(
      processEventTask.handler({
        input: { name: 'order.paid', userId: 'user_1' },
      }),
    ).rejects.toThrow('cannot run before plugin initialization')
  })

  it('preserves existing onInit hooks', async () => {
    const existingOnInit = mock(async () => undefined)

    const plugin = notificationsPlugin()
    const config = plugin({
      collections: [],
      onInit: existingOnInit,
    })

    await config.onInit?.({} as never)
    expect(existingOnInit).toHaveBeenCalledTimes(1)
  })

  it('calls validateNormalizedOptions during plugin creation', () => {
    expect(() =>
      notificationsPlugin({
        channels: [],
      }),
    ).toThrow('payload-notifications: at least one channel must be enabled')
  })
})
