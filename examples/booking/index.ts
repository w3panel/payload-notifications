/**
 * Reference workflow: appointment booking (clinics, salons, classes).
 *
 * - Confirmation to the patient (email + in-app) and an in-app note to the
 *   doctor when an appointment becomes `confirmed`.
 * - A reminder 24 hours before `startsAt`, re-checked when due: it is
 *   cancelled if the appointment was cancelled or moved in the meantime.
 * - A cancellation notice to both.
 *
 * Used by tests/integration/booking.test.ts; copy it into a Payload app as a
 * starting point.
 */
import type { CollectionConfig } from 'payload'
import type { NotificationsPluginOptions } from '../../src'
import { defineTrigger } from '../../src'

export const collections: CollectionConfig[] = [
  {
    slug: 'appointments',
    fields: [
      { name: 'patient', type: 'relationship', relationTo: 'users', required: true },
      { name: 'doctor', type: 'relationship', relationTo: 'users', required: true },
      { name: 'startsAt', type: 'date', required: true },
      {
        name: 'status',
        type: 'select',
        defaultValue: 'pending',
        options: ['pending', 'confirmed', 'cancelled', 'completed'],
      },
      { name: 'clinic', type: 'text' },
    ],
  },
]

const patient = { type: 'eventUser' as const, alias: 'patient' }
const doctor = { type: 'relationship' as const, path: 'doc.doctor', alias: 'doctor' }

export const triggers = [
  defineTrigger({
    slug: 'appointment-confirmed',
    source: { type: 'collection', collection: 'appointments', operation: 'update' },
    conditions: { all: [{ field: 'doc.status', operator: 'changedTo', value: 'confirmed' }] },
    recipients: [patient, doctor],
    deliveries: [
      { channel: 'email', template: 'appointment.confirmed', recipient: 'patient' },
      { channel: 'inapp', template: 'appointment.confirmed', recipient: 'patient' },
      { channel: 'inapp', template: 'appointment.doctor-booked', recipient: 'doctor' },
    ],
    dedupe: { key: 'appointment.confirmed:{{ doc.id }}:{{ doc.startsAt }}' },
  }),
  defineTrigger({
    slug: 'appointment-reminder',
    source: { type: 'collection', collection: 'appointments', operation: 'update' },
    conditions: {
      all: [
        { field: 'doc.status', operator: 'changedTo', value: 'confirmed' },
        { field: 'doc.status', operator: 'equals', value: 'confirmed' },
      ],
    },
    recipients: [patient],
    deliveries: [{ channel: 'email', template: 'appointment.reminder', recipient: 'patient' }],
    schedule: {
      type: 'relative',
      at: 'doc.startsAt',
      offset: '-24h',
      // When due, the appointment is re-read: cancelled → the reminder is cancelled.
      recheckConditions: true,
      skipIfPast: true,
    },
  }),
  defineTrigger({
    slug: 'appointment-cancelled',
    source: { type: 'collection', collection: 'appointments', operation: 'update' },
    conditions: { all: [{ field: 'doc.status', operator: 'changedTo', value: 'cancelled' }] },
    recipients: [patient, doctor],
    deliveries: [
      { channel: 'email', template: 'appointment.cancelled', recipient: 'patient' },
      { channel: 'inapp', template: 'appointment.cancelled', recipient: 'doctor' },
    ],
  }),
]

export const pluginOptions: NotificationsPluginOptions = {
  channels: ['email', 'inapp'],
  collectionEvents: {
    appointments: {
      operations: ['update'],
      capture: ['status', 'startsAt', 'doctor', 'clinic'],
      userField: 'patient',
    },
  },
  triggers,
  templates: {
    registry: {
      'appointment.confirmed': {
        email: {
          subject: 'Your appointment is confirmed',
          body: 'Hi {{ recipient.name }}, see you on {{ date doc.startsAt "MMM d, yyyy" }} at {{ doc.clinic | default "the clinic" }}.',
        },
        inapp: {
          title: 'Appointment confirmed',
          body: '{{ date doc.startsAt "MMM d" }} at {{ doc.clinic }}',
        },
      },
      'appointment.doctor-booked': {
        inapp: { title: 'New appointment', body: 'Booked for {{ date doc.startsAt "MMM d" }}' },
      },
      'appointment.reminder': {
        email: {
          subject: 'Reminder: appointment tomorrow',
          body: 'Your appointment is on {{ date doc.startsAt "MMM d" }}.',
        },
      },
      'appointment.cancelled': {
        email: {
          subject: 'Appointment cancelled',
          body: 'Your appointment on {{ date doc.startsAt "MMM d" }} was cancelled.',
        },
        inapp: { title: 'Appointment cancelled', body: '{{ date doc.startsAt "MMM d" }}' },
      },
    },
  },
}
