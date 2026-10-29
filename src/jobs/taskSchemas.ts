import type { Field } from 'payload'

export const processEventInputSchema: Field[] = [
  {
    name: 'name',
    type: 'text',
    required: true,
  },
  {
    name: 'eventId',
    type: 'text',
  },
  {
    name: 'occurredAt',
    type: 'text',
  },
  {
    name: 'userId',
    type: 'text',
  },
  {
    name: 'payload',
    type: 'json',
  },
  {
    name: 'classification',
    type: 'select',
    options: ['transactional', 'marketing'],
  },
  {
    name: 'idempotencyKey',
    type: 'text',
  },
  {
    name: 'source',
    type: 'json',
  },
  {
    name: 'tenant',
    type: 'text',
  },
  {
    name: 'depth',
    type: 'number',
  },
  {
    name: 'doc',
    type: 'json',
  },
  {
    name: 'previous',
    type: 'json',
  },
]

export const sendNotificationInputSchema: Field[] = [
  {
    name: 'deliveryId',
    type: 'text',
  },
  {
    // Empty for deliveries to static recipients.
    name: 'userId',
    type: 'text',
  },
  {
    name: 'channel',
    type: 'select',
    required: true,
    options: ['email', 'whatsapp', 'sms', 'inapp', 'push'],
  },
  {
    name: 'template',
    type: 'text',
    required: true,
  },
  {
    name: 'event',
    type: 'text',
    required: true,
  },
  {
    name: 'eventPayload',
    type: 'json',
  },
  {
    name: 'classification',
    type: 'select',
    options: ['transactional', 'marketing'],
  },
  {
    name: 'idempotencyKey',
    type: 'text',
  },
  {
    name: 'templateOverrides',
    type: 'json',
  },
  {
    name: 'eventId',
    type: 'text',
  },
  {
    name: 'occurredAt',
    type: 'text',
  },
  {
    name: 'dataSources',
    type: 'json',
  },
]

export const sendNotificationOutputSchema: Field[] = [
  {
    name: 'channel',
    type: 'select',
    options: ['email', 'whatsapp', 'sms', 'inapp', 'push'],
  },
  {
    name: 'status',
    type: 'select',
    options: ['queued', 'sent', 'stored', 'failed', 'skipped', 'cancelled', 'unknown'],
  },
  {
    name: 'reason',
    type: 'text',
  },
  {
    name: 'provider',
    type: 'text',
  },
  {
    name: 'providerMessageId',
    type: 'text',
  },
]
