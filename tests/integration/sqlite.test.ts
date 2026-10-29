import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { buildConfig, getPayload, type Payload } from 'payload'
import { sqliteAdapter } from '@payloadcms/db-sqlite'
import { emitNotificationEvent, notificationsPlugin } from '../../src'

/** A real Payload 3 instance on SQLite (numeric IDs, like D1 and Postgres). */
describe('0.3.x on SQLite', () => {
  let payload: Payload
  const emails: Array<{ to: string; subject: string }> = []

  beforeAll(async () => {
    const config = await buildConfig({
      secret: 'integration-secret-0123456789abcdef',
      db: sqliteAdapter({ client: { url: 'file::memory:' }, push: true }),
      email: (() => ({
        name: 'capture',
        defaultFromAddress: 'noreply@test.dev',
        defaultFromName: 'Test',
        sendEmail: async (message: { to: string; subject: string }) => {
          emails.push(message)
          return {}
        },
      })) as never,
      collections: [{ slug: 'users', auth: true, fields: [{ name: 'name', type: 'text' }] }],
      plugins: [
        notificationsPlugin({
          channels: ['email', 'inapp'],
          rules: [
            {
              event: 'appointment.confirmed',
              channels: ['email', 'inapp'],
              template: 'appointment.confirmed',
            },
          ],
          templates: {
            registry: {
              'appointment.confirmed': {
                email: { subject: 'Confirmed with {{ payload.doctor }}', body: 'See you soon' },
                inapp: { title: 'Session confirmed', body: 'With {{ payload.doctor }}' },
              },
            },
          },
        }),
      ],
      logger: { options: { level: 'error' } } as never,
    })
    payload = await getPayload({ config })
  }, 60_000)

  afterAll(async () => {
    await (payload as unknown as { destroy?: () => Promise<void> }).destroy?.()
  })

  it('sends email and in-app with numeric relationship IDs', async () => {
    const user = (await payload.create({
      collection: 'users',
      data: { email: 'ravi@example.com', password: 'pw-123456', name: 'Ravi' } as never,
    })) as { id: number }
    expect(typeof user.id).toBe('number')

    await emitNotificationEvent({
      payload,
      event: {
        name: 'appointment.confirmed',
        userId: String(user.id),
        payload: { doctor: 'Dr Mehta' },
      },
    })
    for (let round = 0; round < 5; round++) {
      const result = (await payload.jobs.run({ queue: 'notifications', limit: 50 })) as {
        jobStatus?: Record<string, unknown>
      }
      if (!result?.jobStatus || !Object.keys(result.jobStatus).length) break
    }

    expect(emails).toEqual([
      expect.objectContaining({ to: 'ravi@example.com', subject: 'Confirmed with Dr Mehta' }),
    ])
    const inbox = await payload.find({
      collection: 'notifications' as never,
      where: { recipient: { equals: user.id } },
    })
    expect(inbox.docs).toEqual([
      expect.objectContaining({ title: 'Session confirmed', message: 'With Dr Mehta' }),
    ])
    const logs = await payload.find({ collection: 'notification-logs' as never, depth: 0 })
    expect(logs.docs.map((log) => (log as { user?: unknown }).user)).toEqual([user.id, user.id])
  }, 60_000)
})
