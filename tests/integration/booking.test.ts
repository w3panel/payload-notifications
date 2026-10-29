import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { collections, pluginOptions } from '../../examples/booking'
import { createUser, startPayload, testDb, type TestPayload } from './harness'

const TIMEOUT = 60_000

describe(`booking example (${testDb()})`, () => {
  let t: TestPayload
  let patient: { id: string | number }
  let doctor: { id: string | number }

  beforeAll(async () => {
    t = await startPayload({ plugin: pluginOptions, collections })
    patient = await createUser(t.payload, { email: 'patient@example.com', name: 'Ravi' })
    doctor = await createUser(t.payload, { email: 'doctor@example.com', name: 'Dr Mehta' })
  }, TIMEOUT)

  afterAll(async () => {
    await t?.destroy()
  })

  const book = async (inDays: number) =>
    (await t.payload.create({
      collection: 'appointments' as never,
      data: {
        patient: patient.id,
        doctor: doctor.id,
        startsAt: new Date(Date.now() + inDays * 86_400_000).toISOString(),
        clinic: 'Kochi',
      } as never,
      overrideAccess: true,
    })) as { id: string | number }

  const setStatus = (id: string | number, status: string) =>
    t.payload.update({
      collection: 'appointments' as never,
      id,
      data: { status } as never,
      overrideAccess: true,
    })

  it(
    'confirms to the patient and doctor, and schedules the reminder',
    async () => {
      t.emails.length = 0
      const appointment = await book(3)
      await setStatus(appointment.id, 'confirmed')
      await t.runJobs()

      expect(t.emails).toEqual([
        expect.objectContaining({
          to: 'patient@example.com',
          subject: 'Your appointment is confirmed',
        }),
      ])
      const doctorInbox = await t.find('notifications', { recipient: { equals: doctor.id } })
      expect(doctorInbox[0]).toMatchObject({ title: 'New appointment' })

      const [reminder] = await t.find('notification-deliveries', {
        trigger: { equals: 'appointment-reminder' },
      })
      expect(reminder).toMatchObject({ status: 'queued' })
      const due = new Date(String(reminder.scheduledFor)).getTime()
      expect(Math.round((due - Date.now()) / 3_600_000)).toBe(48)
    },
    TIMEOUT,
  )

  it(
    'cancels the reminder when the appointment is cancelled before it is due',
    async () => {
      const [reminder] = await t.find('notification-deliveries', {
        trigger: { equals: 'appointment-reminder' },
      })
      const appointments = await t.find('appointments')
      t.emails.length = 0
      await setStatus(appointments[0].id as string, 'cancelled')
      await t.runJobs()
      expect(t.emails).toEqual([expect.objectContaining({ subject: 'Appointment cancelled' })])

      // The reminder comes due: re-checked against the cancelled appointment.
      await t.releaseWaitingJobs()
      await t.runJobs()
      const [after] = await t.find('notification-deliveries', { id: { equals: reminder.id } })
      expect(after).toMatchObject({ status: 'cancelled' })
      expect(t.emails.filter((email) => email.subject.startsWith('Reminder'))).toEqual([])
    },
    TIMEOUT,
  )

  it(
    'sends the reminder when the appointment is still confirmed',
    async () => {
      const appointment = await book(5)
      await setStatus(appointment.id, 'confirmed')
      await t.runJobs()
      t.emails.length = 0
      await t.releaseWaitingJobs()
      await t.runJobs()
      expect(t.emails).toEqual([
        expect.objectContaining({
          to: 'patient@example.com',
          subject: 'Reminder: appointment tomorrow',
        }),
      ])
    },
    TIMEOUT,
  )

  it(
    'skips the reminder for appointments less than 24 hours away',
    async () => {
      const soon = await book(0.5)
      await setStatus(soon.id, 'confirmed')
      await t.runJobs()
      const reminders = await t.find('notification-deliveries', {
        trigger: { equals: 'appointment-reminder' },
      })
      expect(reminders).toHaveLength(2)
    },
    TIMEOUT,
  )
})
