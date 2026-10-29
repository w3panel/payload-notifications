import { describe, expect, it } from 'bun:test'
import { normalizePluginOptions } from '../src/config/normalizePluginOptions'
import { applyQuietHours, computeSchedule, parseDuration } from '../src/deliveries/schedule'
import { processEvent } from '../src/jobs/processEvent'
import { sendNotification } from '../src/jobs/sendNotification'
import type { NotificationsPluginOptions } from '../src/types'
import { createMemoryPayload } from './helpers/memoryPayload'

type Doc = Record<string, unknown>
const HOUR = 3_600_000

describe('durations and schedules', () => {
  it('parses durations', () => {
    expect(parseDuration('30m')).toBe(30 * 60_000)
    expect(parseDuration('-24h')).toBe(-24 * HOUR)
    expect(parseDuration('2d')).toBe(48 * HOUR)
    expect(parseDuration('1.5h')).toBe(1.5 * HOUR)
    expect(parseDuration(500)).toBe(500)
    expect(parseDuration('soon')).toBeUndefined()
  })

  it('computes delay, at and relative times', () => {
    const now = new Date('2026-10-29T10:00:00Z')
    const scope = {
      booking: { startsAt: '2026-11-02T09:30:00Z' },
      event: { payload: { sendAt: 'nope' } },
    }
    expect(computeSchedule(undefined, scope, now)).toEqual({ ok: true })
    expect(computeSchedule({ type: 'delay', delay: '2h' }, scope, now)).toEqual({
      ok: true,
      at: new Date('2026-10-29T12:00:00Z'),
    })
    expect(computeSchedule({ type: 'at', at: 'booking.startsAt' }, scope, now)).toEqual({
      ok: true,
      at: new Date('2026-11-02T09:30:00Z'),
    })
    expect(
      computeSchedule({ type: 'relative', at: 'booking.startsAt', offset: '-24h' }, scope, now),
    ).toEqual({ ok: true, at: new Date('2026-11-01T09:30:00Z') })
    expect(computeSchedule({ type: 'at', at: 'event.payload.sendAt' }, scope, now)).toEqual({
      ok: false,
      reason: 'no valid timestamp at "event.payload.sendAt"',
    })
  })

  it('moves times out of quiet hours, including windows across midnight', () => {
    const quiet = { start: '21:00', end: '08:00' }
    // 22:30 in Kolkata (17:00Z) → 08:00 Kolkata (02:30Z next day)
    expect(applyQuietHours(new Date('2026-10-29T17:00:00Z'), quiet, 'Asia/Kolkata')).toEqual(
      new Date('2026-10-30T02:30:00Z'),
    )
    // 03:00 UTC is inside the window → 08:00 UTC
    expect(applyQuietHours(new Date('2026-10-29T03:00:20Z'), quiet, 'UTC')).toEqual(
      new Date('2026-10-29T08:00:00Z'),
    )
    // Outside the window: unchanged
    const noon = new Date('2026-10-29T12:00:00Z')
    expect(applyQuietHours(noon, quiet, 'UTC')).toBe(noon)
    // Same-day window
    expect(
      applyQuietHours(new Date('2026-10-29T13:15:00Z'), { start: '13:00', end: '14:00' }, 'UTC'),
    ).toEqual(new Date('2026-10-29T14:00:00Z'))
  })
})

describe('schedule configuration', () => {
  it('validates quiet hours', () => {
    expect(
      normalizePluginOptions({ quietHours: { start: '21:00', end: '08:00' } }).quietHours,
    ).toEqual({
      start: '21:00',
      end: '08:00',
      timezone: 'UTC',
      classifications: ['marketing'],
    })
    expect(() => normalizePluginOptions({ quietHours: { start: '9pm', end: '08:00' } })).toThrow(
      'HH:MM',
    )
    expect(() =>
      normalizePluginOptions({
        quietHours: { start: '21:00', end: '08:00', timezone: 'Mars/Base' },
      }),
    ).toThrow('not a valid IANA zone')
  })

  it('validates trigger schedules', () => {
    const trigger = (schedule: unknown) =>
      normalizePluginOptions({
        triggers: [
          {
            slug: 't',
            event: 'a.b',
            schedule,
            deliveries: [{ channel: 'email', template: 'x' }],
          } as never,
        ],
      })
    expect(() => trigger({ type: 'delay', delay: 'soon' })).toThrow('delay must be a duration')
    expect(() => trigger({ type: 'relative', at: 'booking.startsAt', offset: '-1d' })).toThrow(
      'at must be a path',
    )
    expect(() => trigger({ type: 'weekly' })).toThrow(
      'type must be immediate, delay, at or relative',
    )
    expect(() => trigger({ type: 'at', at: 'event.payload.sendAt' })).not.toThrow()
  })
})

const users = [
  { id: 'u1', name: 'Alex', email: 'alex@example.com', timezone: 'Asia/Kolkata' },
  { id: 'u2', name: 'Sam', email: 'sam@example.com' },
]

const bookingOptions = (extra: Partial<NotificationsPluginOptions> = {}) =>
  normalizePluginOptions({
    channels: ['email'],
    data: { collections: { bookings: { fields: ['status', 'startsAt', 'customer'] } } },
    templates: {
      registry: {
        'booking.reminder': {
          email: { subject: 'Reminder', body: 'See you at {{ booking.startsAt }}' },
        },
      },
    },
    triggers: [
      {
        slug: 'booking-reminder',
        event: 'booking.confirmed',
        data: {
          sources: [
            {
              type: 'collection',
              alias: 'booking',
              collection: 'bookings',
              lookup: { type: 'id', from: 'event.payload.bookingId' },
              fields: ['status', 'startsAt', 'customer'],
            },
          ],
        },
        conditions: { field: 'booking.status', operator: 'equals', value: 'confirmed' },
        schedule: {
          type: 'relative',
          at: 'booking.startsAt',
          offset: '-24h',
          recheckConditions: true,
        },
        deliveries: [{ channel: 'email', template: 'booking.reminder' }],
      },
    ],
    ...extra,
  })

describe('scheduled deliveries', () => {
  const startsAt = () => new Date(Date.now() + 72 * HOUR).toISOString()

  const plan = async (
    memory: ReturnType<typeof createMemoryPayload>,
    options = bookingOptions(),
  ) => {
    await processEvent({
      payload: memory.payload,
      event: { name: 'booking.confirmed', userId: 'u1', payload: { bookingId: 'b1' } },
      options,
    })
    return (memory.queue.mock.calls[0] as unknown as [Doc])?.[0]
  }

  it('schedules relative to a data field and queues with waitUntil', async () => {
    const memory = createMemoryPayload({
      users,
      bookings: [{ id: 'b1', status: 'confirmed', startsAt: startsAt() }],
    })
    const job = await plan(memory)
    const [delivery] = memory.docs('notification-deliveries')
    const expected = new Date(Date.parse(memory.db.bookings[0].startsAt as string) - 24 * HOUR)
    expect(delivery.scheduledFor).toBe(expected.toISOString())
    expect(delivery.recheckConditions).toBe(true)
    expect(job.waitUntil).toEqual(expected)
  })

  it('cancels at send time when the booking was cancelled', async () => {
    const memory = createMemoryPayload({
      users,
      bookings: [{ id: 'b1', status: 'confirmed', startsAt: startsAt() }],
    })
    const job = await plan(memory)
    memory.db.bookings[0].status = 'cancelled'

    const result = await sendNotification({
      payload: memory.payload,
      input: job.input as never,
      options: bookingOptions(),
    })
    expect(result).toMatchObject({
      status: 'cancelled',
      reason: 'trigger conditions no longer match',
    })
    expect(memory.docs('notification-deliveries')[0]).toMatchObject({
      status: 'cancelled',
      skipReason: 'trigger conditions no longer match',
    })
    expect(memory.sendEmail).toHaveBeenCalledTimes(0)
    expect(memory.docs('notification-logs').at(-1)).toMatchObject({
      status: 'skipped',
      error: 'Cancelled: trigger conditions no longer match',
    })
  })

  it('renders from fresh data when the booking still applies', async () => {
    const memory = createMemoryPayload({
      users,
      bookings: [{ id: 'b1', status: 'confirmed', startsAt: startsAt() }],
    })
    const job = await plan(memory)
    memory.db.bookings[0].startsAt = '2030-01-01T10:00:00.000Z'

    const result = await sendNotification({
      payload: memory.payload,
      input: job.input as never,
      options: bookingOptions(),
    })
    expect(result?.status).toBe('sent')
    expect((memory.sendEmail.mock.calls[0][0] as unknown as Doc).text).toBe(
      'See you at 2030-01-01T10:00:00.000Z',
    )
  })

  it('cancels when the trigger was disabled before sending', async () => {
    const memory = createMemoryPayload({
      users,
      bookings: [{ id: 'b1', status: 'confirmed', startsAt: startsAt() }],
    })
    const job = await plan(memory)
    const disabled = bookingOptions()
    disabled.triggers[0].enabled = false
    const result = await sendNotification({
      payload: memory.payload,
      input: job.input as never,
      options: disabled,
    })
    expect(result).toMatchObject({
      status: 'cancelled',
      reason: 'trigger "booking-reminder" is disabled',
    })
  })

  it('skips the trigger when skipIfPast and the time has passed', async () => {
    const memory = createMemoryPayload({
      users,
      bookings: [
        { id: 'b1', status: 'confirmed', startsAt: new Date(Date.now() + HOUR).toISOString() },
      ],
    })
    const options = bookingOptions()
    options.triggers[0].schedule = {
      type: 'relative',
      at: 'booking.startsAt',
      offset: '-24h',
      skipIfPast: true,
    }
    await plan(memory, options)
    expect(memory.docs('notification-deliveries')).toHaveLength(0)
    expect(String(memory.docs('notification-logs')[0].error)).toContain('has already passed')
  })

  it('applies quiet hours per recipient timezone for marketing only', async () => {
    // A two-hour UTC window around now: quiet for a UTC recipient, not for one in Kolkata (+5:30).
    const clock = (offsetMinutes: number) => {
      const date = new Date(Date.now() + offsetMinutes * 60_000)
      return `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`
    }
    const options = (classification: 'marketing' | 'transactional') =>
      normalizePluginOptions({
        channels: ['email'],
        quietHours: { start: clock(-60), end: clock(60), timezone: 'UTC' },
        triggers: [
          {
            slug: 'promo',
            event: 'promo.sent',
            classification,
            recipients: [{ type: 'eventUser' }, { type: 'context', path: 'payload.friend' }],
            deliveries: [{ channel: 'email', template: 'order.paid' }],
          },
        ],
      })
    const run = async (classification: 'marketing' | 'transactional') => {
      const memory = createMemoryPayload({ users })
      await processEvent({
        payload: memory.payload,
        event: { name: 'promo.sent', userId: 'u1', payload: { friend: 'u2' } },
        options: options(classification),
      })
      return Object.fromEntries(
        memory.docs('notification-deliveries').map((delivery) => [delivery.recipientId, delivery]),
      )
    }

    const marketing = await run('marketing')
    expect(marketing.u1.scheduledFor).toBeUndefined()
    const held = Date.parse(marketing.u2.scheduledFor as string) - Date.now()
    expect(held).toBeGreaterThan(55 * 60_000)
    expect(held).toBeLessThanOrEqual(60 * 60_000)

    const transactional = await run('transactional')
    expect(transactional.u2.scheduledFor).toBeUndefined()
  })
})
