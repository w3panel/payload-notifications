import { describe, expect, it, mock } from 'bun:test'
import * as api from '../src/index'
import { normalizePluginOptions } from '../src/config/normalizePluginOptions'
import { isDuplicateKeyError } from '../src/data/errors'
import {
  buildSendOnceKey,
  deliveryRecipientIdentity,
  sendOnceEventKey,
} from '../src/deliveries/keys'
import { planDeliveries } from '../src/deliveries/plan'
import { processEvent } from '../src/jobs/processEvent'
import { sendNotification } from '../src/jobs/sendNotification'
import { emitLifecycle } from '../src/observability'
import { ProviderError } from '../src/providers/errors'
import type {
  NotificationBeforeSendArgs,
  NotificationLifecycleContext,
  NotificationLifecycleEvent,
  NotificationProvider,
  NotificationsPluginOptions,
} from '../src/types'
import { createMemoryPayload } from './helpers/memoryPayload'

type Doc = Record<string, unknown>

const templates = {
  registry: {
    'order.paid': {
      email: { subject: 'Order {{ payload.orderId }} paid', body: 'Thanks' },
      inapp: { title: 'Paid', body: 'Order {{ payload.orderId }}' },
      sms: 'Order {{ payload.orderId }} paid',
    },
    'order.paid.staff': { email: { subject: 'New order {{ payload.orderId }}', body: 'Pack it' } },
  },
}

/** An SMS provider that always sends. */
const okSms: NotificationProvider = {
  name: 'sms-ok',
  channels: ['sms'],
  capabilities: { html: false, hsm: false, media: false },
  send: async () => ({ status: 'sent', providerMessageId: 'SM1' }),
}

const users = [
  { id: 'u1', name: 'Alex', email: 'alex@example.com', phone: '+971501234567' },
  { id: 'u2', name: 'Sam', email: 'sam@example.com' },
]

/** Two routes for one event: the customer, and the store mailbox (which may be the same inbox). */
const twoRoutes = (mailbox: string, extra: Partial<NotificationsPluginOptions> = {}) =>
  normalizePluginOptions({
    channels: ['email', 'inapp', 'sms'],
    providers: { custom: { sms: okSms } },
    templates,
    triggers: [
      {
        slug: 'paid-customer',
        event: 'order.paid',
        recipients: [{ type: 'eventUser' }],
        deliveries: [
          { channel: 'email', template: 'order.paid' },
          { channel: 'inapp', template: 'order.paid' },
        ],
      },
      {
        slug: 'paid-mailbox',
        event: 'order.paid',
        recipients: [{ type: 'static', email: mailbox, alias: 'mailbox' }],
        deliveries: [{ channel: 'email', template: 'order.paid.staff', recipient: 'mailbox' }],
      },
    ],
    ...extra,
  })

const paid = {
  name: 'order.paid',
  idempotencyKey: 'order:7:paid',
  userId: 'u1',
  payload: { orderId: 'EF-7' },
}

describe('deliveries.key', () => {
  it("defaults to 'trigger' and rejects unknown modes", () => {
    expect(normalizePluginOptions({}).deliveries.key).toBe('trigger')
    expect(normalizePluginOptions({ deliveries: { key: 'recipient' } }).deliveries.key).toBe(
      'recipient',
    )
    expect(() => normalizePluginOptions({ deliveries: { key: 'inbox' as never } })).toThrow(
      "deliveries.key must be 'trigger' or 'recipient'",
    )
  })

  it('keeps one delivery per trigger and template by default', async () => {
    const memory = createMemoryPayload({ users })
    await processEvent({
      payload: memory.payload,
      event: paid,
      options: twoRoutes('ALEX@example.com '),
    })
    const deliveries = memory.docs('notification-deliveries')
    expect(deliveries.map((d) => [d.trigger, d.channel, d.idempotencyKey])).toEqual([
      ['paid-customer', 'email', 'order:7:paid::paid-customer::user:u1::email::order.paid'],
      ['paid-customer', 'inapp', 'order:7:paid::paid-customer::user:u1::inapp::order.paid'],
      [
        'paid-mailbox',
        'email',
        'order:7:paid::paid-mailbox::email:alex@example.com::email::order.paid.staff',
      ],
    ])
  })

  it("'recipient' sends one email to an inbox reached as an account and as a mailbox", async () => {
    const memory = createMemoryPayload({ users })
    const stages: NotificationLifecycleEvent[] = []
    const options = twoRoutes(' ALEX@Example.com', {
      deliveries: { key: 'recipient' },
      observability: { onEvent: (event) => void stages.push(event) },
    })
    const result = await processEvent({ payload: memory.payload, event: paid, options })

    const deliveries = memory.docs('notification-deliveries')
    expect(deliveries.map((d) => [d.trigger, d.channel])).toEqual([
      ['paid-customer', 'email'],
      ['paid-customer', 'inapp'],
    ])
    const emailKey = String(deliveries[0].idempotencyKey)
    expect(emailKey).toMatch(/^order:7:paid::email::email#[0-9a-f]{32}$/)
    expect(emailKey).not.toContain('alex')
    expect(deliveries[1].idempotencyKey).toBe('order:7:paid::inapp::user#u1')
    expect(result.deliveries.map((d) => [d.trigger, d.status, d.deliveryId])).toEqual([
      ['paid-customer', 'queued', deliveries[0].id],
      ['paid-customer', 'queued', deliveries[1].id],
      ['paid-mailbox', 'existing', deliveries[0].id],
    ])
    const duplicate = stages.find((event) => event.stage === 'duplicate')
    expect(duplicate).toMatchObject({
      trigger: 'paid-mailbox',
      deliveryId: deliveries[0].id,
      channel: 'email',
      reason: `Delivery ${deliveries[0].id} already holds this delivery key`,
    })
    expect(memory.queue).toHaveBeenCalledTimes(2)
  })

  it("'recipient' still sends to different inboxes, events and channels", async () => {
    const memory = createMemoryPayload({ users })
    const options = twoRoutes('orders@shop.test', { deliveries: { key: 'recipient' } })
    await processEvent({ payload: memory.payload, event: paid, options })
    await processEvent({
      payload: memory.payload,
      event: { ...paid, idempotencyKey: 'order:8:paid' },
      options,
    })
    expect(memory.docs('notification-deliveries')).toHaveLength(6)
  })

  it('finds the existing delivery when two plans race for the same key', async () => {
    const memory = createMemoryPayload({ users })
    const options = normalizePluginOptions({
      channels: ['email'],
      templates,
      deliveries: { key: 'recipient' },
      triggers: [
        {
          slug: 'paid-customer',
          event: 'order.paid',
          recipients: [{ type: 'eventUser' }],
          deliveries: [{ channel: 'email', template: 'order.paid' }],
        },
      ],
    })
    // Hold both key lookups until both plans have made one, so both go on to create.
    const find = memory.payload.find as (args: Doc) => Promise<{ docs: Doc[] }>
    let release!: () => void
    const bothLooked = new Promise<void>((resolve) => (release = resolve))
    let lookups = 0
    ;(memory.payload as { find: unknown }).find = async (args: Doc) => {
      const where = args.where as Doc | undefined
      if (args.collection === 'notification-deliveries' && where?.idempotencyKey) {
        const result = await find(args)
        if (++lookups === 2) release()
        if (lookups <= 2) await bothLooked
        return result
      }
      return find(args)
    }

    const [a, b] = await Promise.all([
      planDeliveries({ payload: memory.payload, event: paid, options }),
      planDeliveries({ payload: memory.payload, event: paid, options }),
    ])

    const deliveries = memory.docs('notification-deliveries')
    expect(deliveries).toHaveLength(1)
    expect(
      memory.create.mock.calls.filter((c) => c[0].collection === 'notification-deliveries'),
    ).toHaveLength(2)
    expect([a.deliveries[0].status, b.deliveries[0].status].sort()).toEqual(['existing', 'queued'])
    expect(a.deliveries[0].deliveryId).toBe(String(deliveries[0].id))
    expect(b.deliveries[0].deliveryId).toBe(String(deliveries[0].id))
    expect(memory.queue).toHaveBeenCalledTimes(1)
  })

  it('identifies email and phone recipients by normalised destination', async () => {
    const email = (destination: string, recipientId?: string) =>
      deliveryRecipientIdentity({ channel: 'email', destination, recipientId })
    expect(await email(' Alex@Example.COM ', 'u1')).toBe(await email('alex@example.com'))
    expect(await email('alex@example.com')).not.toBe(await email('sam@example.com'))

    const phone = (destination: string) =>
      deliveryRecipientIdentity({ channel: 'whatsapp', destination })
    expect(await phone('+971 50 123-4567')).toBe(await phone('+971501234567'))
    expect(await phone('+971501234567')).toMatch(/^phone#[0-9a-f]{32}$/)

    expect(
      await deliveryRecipientIdentity({ channel: 'inapp', destination: 'x', recipientId: 'u1' }),
    ).toBe('user#u1')
    expect(await deliveryRecipientIdentity({ channel: 'email', recipientKey: 'user:u9' })).toMatch(
      /^key#[0-9a-f]{32}$/,
    )
  })

  it('reads the event key back from a send-once key only', async () => {
    const key = await buildSendOnceKey({
      eventKey: 'order::7',
      channel: 'sms',
      destination: '+971501234567',
    })
    expect(sendOnceEventKey(key)).toBe('order::7')
    expect(
      sendOnceEventKey('order:7:paid::paid-customer::user:u1::email::order.paid'),
    ).toBeUndefined()
  })

  it("gives a 'recipient' fallback a send-once key, so it never doubles an existing delivery", async () => {
    const sms: NotificationProvider = {
      name: 'sms-test',
      channels: ['sms'],
      capabilities: { html: false, hsm: false, media: false },
      send: async () => {
        throw new ProviderError('Unreachable handset', { status: 400 })
      },
    }
    const options = normalizePluginOptions({
      channels: ['sms', 'email'],
      providers: { custom: { sms } },
      reliability: { attempts: 1 },
      deliveries: { key: 'recipient' },
      templates,
      triggers: [
        {
          slug: 'paid-sms',
          event: 'order.paid',
          recipients: [{ type: 'eventUser' }],
          deliveries: [
            { channel: 'sms', template: 'order.paid', fallback: { channel: 'email' } },
            { channel: 'email', template: 'order.paid' },
          ],
        },
      ],
    })
    const memory = createMemoryPayload({ users })
    await processEvent({ payload: memory.payload, event: paid, options })
    for (const call of memory.queue.mock.calls) {
      const { input } = (call as unknown as [{ input: Doc }])[0]
      await sendNotification({ payload: memory.payload, input: input as never, options })
    }
    // The SMS failed for good; its email fallback is the delivery the email route already holds.
    expect(memory.docs('notification-deliveries').map((d) => [d.channel, d.status])).toEqual([
      ['sms', 'failed'],
      ['email', 'sent'],
    ])
    expect(memory.sendEmail).toHaveBeenCalledTimes(1)
  })
})

describe('observability.onEvent context', () => {
  it('passes payload and the delivery idempotency key, never in the event or log', async () => {
    const memory = createMemoryPayload({ users })
    const calls: Array<[NotificationLifecycleEvent, NotificationLifecycleContext]> = []
    const options = twoRoutes('orders@shop.test', {
      observability: {
        log: true,
        onEvent: (event, context) => void calls.push([event, context]),
      },
    })
    await processEvent({ payload: memory.payload, event: paid, options })

    const planned = calls.filter(([event]) => event.stage === 'planned')
    const keys = memory.docs('notification-deliveries').map((d) => d.idempotencyKey)
    expect(planned.map(([, context]) => context.idempotencyKey)).toEqual(keys)
    for (const [event, context] of calls) {
      expect(context.payload).toBe(memory.payload)
      expect(event).not.toHaveProperty('idempotencyKey')
    }
    const matched = calls.find(([event]) => event.stage === 'matched')
    expect(matched?.[1]).toEqual({ payload: memory.payload })
    const logged = JSON.stringify(memory.logger.info.mock.calls)
    expect(logged).not.toContain('order:7:paid::')
  })

  it('passes the key on send stages too', async () => {
    const memory = createMemoryPayload({ users })
    const contexts: NotificationLifecycleContext[] = []
    const options = twoRoutes('orders@shop.test', {
      jobs: { inlineSendLimit: 5 },
      observability: {
        onEvent: (event, context) => {
          if (event.stage === 'sent') contexts.push(context)
        },
      },
    })
    await processEvent({ payload: memory.payload, event: paid, options })
    expect(contexts.map((context) => context.idempotencyKey)).toEqual(
      memory.docs('notification-deliveries').map((d) => d.idempotencyKey),
    )
  })

  it('still accepts one-argument handlers', async () => {
    const onEvent = mock((_event: NotificationLifecycleEvent) => undefined)
    await emitLifecycle(
      createMemoryPayload().payload,
      { observability: { onEvent, log: false } },
      { stage: 'matched', event: 'x' },
    )
    expect(onEvent).toHaveBeenCalledTimes(1)
  })
})

describe('conditions-not-met lifecycle stage', () => {
  it('reports a matched trigger whose conditions do not hold', async () => {
    const memory = createMemoryPayload({ users })
    const stages: NotificationLifecycleEvent[] = []
    const options = normalizePluginOptions({
      channels: ['email'],
      templates,
      observability: { onEvent: (event) => void stages.push(event) },
      triggers: [
        {
          slug: 'dispatched',
          event: 'order.paid',
          conditions: { field: 'payload.stage', operator: 'equals', value: 'dispatched' },
          recipients: [{ type: 'eventUser' }],
          deliveries: [{ channel: 'email', template: 'order.paid' }],
        },
        {
          slug: 'vip-only',
          event: 'order.paid',
          condition: (payload) => payload.vip === true,
          recipients: [{ type: 'eventUser' }],
          deliveries: [{ channel: 'email', template: 'order.paid' }],
        },
      ],
    })
    await processEvent({
      payload: memory.payload,
      event: { ...paid, payload: { orderId: 'EF-7', stage: 'out_for_delivery' } },
      options,
    })
    expect(memory.docs('notification-deliveries')).toHaveLength(0)
    expect(
      stages
        .filter((event) => event.stage === 'conditions-not-met')
        .map((event) => [event.trigger, event.reason, typeof event.eventId]),
    ).toEqual([
      ['dispatched', 'conditions did not match', 'string'],
      ['vip-only', 'condition function returned false', 'string'],
    ])
    // Not logged as a skipped trigger.
    expect(memory.docs('notification-logs')).toHaveLength(0)
  })
})

describe('deliveries.beforeSend', () => {
  const build = (
    beforeSend: NonNullable<NotificationsPluginOptions['deliveries']>['beforeSend'],
    stages: NotificationLifecycleEvent[] = [],
  ) =>
    normalizePluginOptions({
      channels: ['email', 'sms'],
      providers: { custom: { sms: okSms } },
      templates,
      deliveries: { beforeSend },
      observability: { onEvent: (event) => void stages.push(event) },
      triggers: [
        {
          slug: 'paid-customer',
          event: 'order.paid',
          recipients: [{ type: 'eventUser' }],
          deliveries: [
            {
              channel: 'email',
              template: 'order.paid',
              fallback: { channel: 'sms', on: ['policy', 'permanent', 'no-destination'] },
            },
          ],
        },
      ],
    })

  const sendQueued = async (memory: ReturnType<typeof createMemoryPayload>, options: never) => {
    const { input } = (memory.queue.mock.calls[0] as unknown as [{ input: Doc }])[0]
    return sendNotification({ payload: memory.payload, input: input as never, options })
  }

  it('cancels a vetoed delivery with the reason and emits a lifecycle event', async () => {
    const memory = createMemoryPayload({ users })
    const stages: NotificationLifecycleEvent[] = []
    const seen: NotificationBeforeSendArgs[] = []
    const options = build(async (args) => {
      seen.push(args)
      return { allow: false, reason: 'Order already out for delivery' }
    }, stages)
    await processEvent({ payload: memory.payload, event: paid, options })
    const result = await sendQueued(memory, options as never)

    const [delivery] = memory.docs('notification-deliveries')
    expect(result).toMatchObject({ status: 'cancelled', reason: 'Order already out for delivery' })
    expect(delivery).toMatchObject({
      status: 'cancelled',
      skipReason: 'Order already out for delivery',
    })
    expect(memory.sendEmail).not.toHaveBeenCalled()
    // No fallback for a veto.
    expect(memory.docs('notification-deliveries')).toHaveLength(1)
    expect(stages.at(-1)).toMatchObject({
      stage: 'cancelled',
      deliveryId: delivery.id,
      reason: 'Order already out for delivery',
    })
    expect(memory.docs('notification-logs').at(-1)).toMatchObject({
      status: 'skipped',
      error: 'Cancelled: Order already out for delivery',
    })

    expect(seen).toHaveLength(1)
    expect(seen[0].payload).toBe(memory.payload)
    expect(seen[0].attempt).toBe(1)
    expect(seen[0].delivery).toMatchObject({
      id: String(delivery.id),
      event: 'order.paid',
      trigger: 'paid-customer',
      channel: 'email',
      template: 'order.paid',
      recipientKey: 'user:u1',
      recipientId: 'u1',
      destination: 'alex@example.com',
      idempotencyKey: delivery.idempotencyKey,
    })
    expect(seen[0].delivery.context?.payload).toEqual({ orderId: 'EF-7' })
  })

  it('uses a default reason when none is given', async () => {
    const memory = createMemoryPayload({ users })
    const options = build(() => ({ allow: false }))
    await processEvent({ payload: memory.payload, event: paid, options })
    await sendQueued(memory, options as never)
    expect(memory.docs('notification-deliveries')[0].skipReason).toBe(
      'Cancelled by deliveries.beforeSend',
    )
  })

  it('sends when the hook allows or returns nothing', async () => {
    for (const decision of [undefined, { allow: true }]) {
      const memory = createMemoryPayload({ users })
      const options = build(async () => decision)
      await processEvent({ payload: memory.payload, event: paid, options })
      await sendQueued(memory, options as never)
      expect(memory.docs('notification-deliveries')[0].status).toBe('sent')
      expect(memory.sendEmail).toHaveBeenCalledTimes(1)
    }
  })

  it('leaves the delivery queued when the hook throws, so the job retries it', async () => {
    const memory = createMemoryPayload({ users })
    const options = build(async () => {
      throw new Error('lookup failed')
    })
    await processEvent({ payload: memory.payload, event: paid, options })
    await expect(sendQueued(memory, options as never)).rejects.toThrow('lookup failed')
    expect(memory.docs('notification-deliveries')[0]).toMatchObject({
      status: 'queued',
      attempts: 0,
    })
    expect(memory.sendEmail).not.toHaveBeenCalled()
  })

  it('is not called for a delivery that is already final', async () => {
    const memory = createMemoryPayload({ users })
    const beforeSend = mock(async () => undefined)
    const options = build(beforeSend)
    await processEvent({ payload: memory.payload, event: paid, options })
    memory.docs('notification-deliveries')[0].status = 'cancelled'
    await sendQueued(memory, options as never)
    expect(beforeSend).not.toHaveBeenCalled()
  })
})

describe('isDuplicateKeyError', () => {
  it('is exported from the package entry', () => {
    expect(api.isDuplicateKeyError).toBe(isDuplicateKeyError)
  })

  it('recognises Postgres unique violations, wrapped or not', () => {
    const pg = Object.assign(
      new Error('duplicate key value violates unique constraint "deliveries_key_idx"'),
      { code: '23505' },
    )
    expect(isDuplicateKeyError(pg)).toBe(true)
    expect(isDuplicateKeyError(Object.assign(new Error('insert failed'), { code: '23505' }))).toBe(
      true,
    )
    // drizzle-orm wraps driver errors: "Failed query: insert into …" with the driver error as cause.
    const wrapped = new Error('Failed query: insert into "notification_deliveries" …', {
      cause: Object.assign(new Error('violates constraint'), { code: '23505' }),
    })
    expect(isDuplicateKeyError(wrapped)).toBe(true)
  })

  it('recognises SQLite, libSQL and D1 unique violations', () => {
    expect(
      isDuplicateKeyError(
        new Error('D1_ERROR: UNIQUE constraint failed: notification_deliveries.idempotency_key'),
      ),
    ).toBe(true)
    const libsql = Object.assign(new Error('SQLITE_CONSTRAINT: SQLite error'), {
      code: 'SQLITE_CONSTRAINT',
      extendedCode: 'SQLITE_CONSTRAINT_UNIQUE',
    })
    expect(isDuplicateKeyError(libsql)).toBe(true)
    const wrapped = new Error('Failed query: insert into `notification_deliveries` …', {
      cause: new Error('SQLITE_CONSTRAINT: UNIQUE constraint failed: deliveries.key'),
    })
    expect(isDuplicateKeyError(wrapped)).toBe(true)
  })

  it('ignores other constraint and query errors', () => {
    const notNull = Object.assign(
      new Error('SQLITE_CONSTRAINT: NOT NULL constraint failed: deliveries.event'),
      { code: 'SQLITE_CONSTRAINT', extendedCode: 'SQLITE_CONSTRAINT_NOTNULL' },
    )
    expect(isDuplicateKeyError(notNull)).toBe(false)
    expect(
      isDuplicateKeyError(Object.assign(new Error('null value in column'), { code: '23502' })),
    ).toBe(false)
    expect(isDuplicateKeyError(new Error('Failed query', { cause: new Error('timeout') }))).toBe(
      false,
    )
    expect(isDuplicateKeyError(undefined)).toBe(false)
    expect(isDuplicateKeyError(null)).toBe(false)
  })
})
