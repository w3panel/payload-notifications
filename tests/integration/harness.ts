import { buildConfig, getPayload, type CollectionConfig, type Payload } from 'payload'
import { notificationsPlugin } from '../../src'
import type { NotificationsPluginOptions } from '../../src/types'

/**
 * A real Payload instance for integration tests. SQLite (in memory) by
 * default; PAYLOAD_TEST_POSTGRES_URL or PAYLOAD_TEST_MONGODB_URL run the same
 * tests against Postgres or MongoDB (with the matching adapter installed).
 */
export type TestDb = 'sqlite' | 'postgres' | 'mongodb'

export const testDb = (): TestDb =>
  process.env.PAYLOAD_TEST_POSTGRES_URL
    ? 'postgres'
    : process.env.PAYLOAD_TEST_MONGODB_URL
      ? 'mongodb'
      : 'sqlite'

let instance = 0

// Adapters are imported by name so the typecheck does not need the optional ones.
const importAdapter = (name: string) =>
  import(name) as Promise<Record<string, (args: unknown) => unknown>>

const dbAdapter = async () => {
  const id = `${Date.now()}_${process.pid}_${instance++}`
  switch (testDb()) {
    case 'postgres': {
      const { postgresAdapter } = await importAdapter('@payloadcms/db-postgres')
      return postgresAdapter({
        pool: { connectionString: process.env.PAYLOAD_TEST_POSTGRES_URL },
        schemaName: `pn_${id}`,
        push: true,
      })
    }
    case 'mongodb': {
      const { mongooseAdapter } = await importAdapter('@payloadcms/db-mongodb')
      const url = new URL(process.env.PAYLOAD_TEST_MONGODB_URL as string)
      url.pathname = `/pn_${id}`
      return mongooseAdapter({ url: url.toString() })
    }
    default: {
      const { sqliteAdapter } = await importAdapter('@payloadcms/db-sqlite')
      return sqliteAdapter({ client: { url: 'file::memory:' }, push: true })
    }
  }
}

export type SentEmail = { to: string; subject: string; html?: string; text?: string }

export type TestPayload = {
  payload: Payload
  emails: SentEmail[]
  /** Runs queued notification jobs until none are left (jobs waiting for later are skipped). */
  runJobs: () => Promise<void>
  /** Makes jobs waiting for a later time runnable now. */
  releaseWaitingJobs: () => Promise<number>
  /** Local API call that bypasses access (Payload 4 defaults `overrideAccess` to false). */
  find: (
    collection: string,
    where?: Record<string, unknown>,
  ) => Promise<Array<Record<string, unknown>>>
  destroy: () => Promise<void>
}

export const startPayload = async ({
  plugin,
  collections = [],
}: {
  plugin: NotificationsPluginOptions
  collections?: CollectionConfig[]
}): Promise<TestPayload> => {
  const emails: SentEmail[] = []
  const config = await buildConfig({
    secret: 'integration-secret-0123456789abcdef',
    serverURL: 'https://shop.test',
    db: (await dbAdapter()) as never,
    email: (() => ({
      name: 'capture',
      defaultFromAddress: 'noreply@shop.test',
      defaultFromName: 'Shop',
      sendEmail: async (message: SentEmail) => {
        emails.push(message)
        return { accepted: [message.to] }
      },
    })) as never,
    collections: [
      {
        slug: 'users',
        auth: true,
        fields: [
          { name: 'name', type: 'text' },
          { name: 'phone', type: 'text' },
          { name: 'role', type: 'text' },
        ],
      },
      ...collections,
    ],
    plugins: [notificationsPlugin(plugin)],
    jobs: { enableConcurrencyControl: true } as never,
    logger: { options: { level: 'error' } } as never,
  })
  const payload = await getPayload({ config, key: `integration-${instance}` } as never)
  const queue = 'notifications'

  const runJobs = async () => {
    for (let round = 0; round < 20; round++) {
      const result = (await payload.jobs.run({
        queue,
        limit: 100,
        overrideAccess: true,
      } as never)) as {
        jobStatus?: Record<string, unknown>
        noJobsRemaining?: boolean
      }
      if (!result?.jobStatus || !Object.keys(result.jobStatus).length) return
    }
  }

  const releaseWaitingJobs = async () => {
    const waiting = await payload.find({
      collection: 'payload-jobs' as never,
      where: { and: [{ completedAt: { exists: false } }, { waitUntil: { exists: true } }] },
      limit: 100,
      overrideAccess: true,
    })
    for (const job of waiting.docs as Array<{ id: string | number }>) {
      await payload.update({
        collection: 'payload-jobs' as never,
        id: job.id,
        data: { waitUntil: new Date(Date.now() - 1000).toISOString() } as never,
        overrideAccess: true,
      })
    }
    return waiting.docs.length
  }

  const find = async (collection: string, where?: Record<string, unknown>) =>
    (
      await payload.find({
        collection: collection as never,
        where: where as never,
        limit: 200,
        depth: 0,
        sort: 'createdAt',
        overrideAccess: true,
      })
    ).docs as Array<Record<string, unknown>>

  return {
    payload,
    emails,
    runJobs,
    releaseWaitingJobs,
    find,
    destroy: async () => {
      await (payload as unknown as { destroy?: () => Promise<void> }).destroy?.()
    },
  }
}

export const createUser = (payload: Payload, data: Record<string, unknown>) =>
  payload.create({
    collection: 'users' as never,
    data: { password: 'integration-pw-123', ...data } as never,
    overrideAccess: true,
  }) as Promise<Record<string, unknown> & { id: string | number }>
