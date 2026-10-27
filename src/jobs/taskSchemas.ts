import type { Field } from 'payload'

export const processEventInputSchema: Field[] = [
  {
    name: 'name',
    type: 'text',
    required: true,
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
]

export const sendNotificationInputSchema: Field[] = [
  {
    name: 'userId',
    type: 'text',
    required: true,
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
    options: ['queued', 'sent', 'stored', 'failed', 'skipped'],
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
