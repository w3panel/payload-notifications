import type { NotificationDuration, NotificationSchedule } from '../types'
import { getPath } from '../data/paths'

const UNITS: Record<string, number> = {
  ms: 1,
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
}

/** `30m`, `24h`, `-24h`, `2d`, `1w`, or milliseconds. Returns undefined when invalid. */
export const parseDuration = (value: NotificationDuration): number | undefined => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  const match = /^(-)?(\d+(?:\.\d+)?)(ms|s|m|h|d|w)$/.exec(String(value).trim())
  if (!match) return undefined
  const amount = Number(match[2]) * UNITS[match[3]]
  return match[1] ? -amount : amount
}

const toDate = (value: unknown): Date | undefined => {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value
  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? undefined : date
  }
  return undefined
}

export type ScheduleResult = { ok: true; at?: Date } | { ok: false; reason: string }

/**
 * Computes when deliveries should be sent. `at` is undefined for immediate
 * sends. `scope` is the condition scope (`event`, `doc`, aliases …).
 */
export const computeSchedule = (
  schedule: NotificationSchedule | undefined,
  scope: Record<string, unknown>,
  now = new Date(),
): ScheduleResult => {
  if (!schedule || schedule.type === 'immediate') return { ok: true }

  if (schedule.type === 'delay') {
    const delay = parseDuration(schedule.delay)
    if (delay === undefined)
      return { ok: false, reason: `invalid delay "${String(schedule.delay)}"` }
    return { ok: true, at: new Date(now.getTime() + delay) }
  }

  const base = toDate(getPath(scope, schedule.at))
  if (!base) return { ok: false, reason: `no valid timestamp at "${schedule.at}"` }
  if (schedule.type === 'at') return { ok: true, at: base }

  const offset = parseDuration(schedule.offset)
  if (offset === undefined)
    return { ok: false, reason: `invalid offset "${String(schedule.offset)}"` }
  return { ok: true, at: new Date(base.getTime() + offset) }
}

const CLOCK = /^([01]\d|2[0-3]):([0-5]\d)$/

export const parseClock = (value: string): number | undefined => {
  const match = CLOCK.exec(value)
  return match ? Number(match[1]) * 60 + Number(match[2]) : undefined
}

export const isValidTimeZone = (timeZone: string): boolean => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone })
    return true
  } catch {
    return false
  }
}

const localMinutes = (date: Date, timeZone: string): number => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? 0)
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? 0)
  return hour * 60 + minute
}

/**
 * Moves `date` to the end of the quiet window when it falls inside it, in
 * `timeZone`. Windows may wrap midnight (`21:00`–`08:00`).
 */
export const applyQuietHours = (
  date: Date,
  quietHours: { start: string; end: string },
  timeZone: string,
): Date => {
  const start = parseClock(quietHours.start)
  const end = parseClock(quietHours.end)
  if (start === undefined || end === undefined || start === end) return date

  const local = localMinutes(date, timeZone)
  const inside = start < end ? local >= start && local < end : local >= start || local < end
  if (!inside) return date

  const minutesUntilEnd = (end - local + 1440) % 1440
  const startOfMinute = date.getTime() - (date.getUTCSeconds() * 1000 + date.getUTCMilliseconds())
  return new Date(startOfMinute + minutesUntilEnd * 60_000)
}
