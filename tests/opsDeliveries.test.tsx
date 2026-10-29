import { describe, expect, it, mock } from 'bun:test'
import { renderToString } from 'react-dom/server'
import {
  cancelDelivery,
  deliveryActions,
  deliveryEndpoints,
  inspectDelivery,
  retryDelivery,
} from '../src/admin-ops/deliveries'
import { normalizePluginOptions } from '../src/config/normalizePluginOptions'
import { createMemoryPayload } from './helpers/memoryPayload'

// @payloadcms/ui is an optional peer that is not installed for development.
mock.module('@payloadcms/ui', () => ({
  useForm: () => ({ getData: () => ({}) }),
  useField: () => ({ value: undefined, setValue: () => {} }),
  useDocumentInfo: () => ({}),
  useFormModified: () => false,
}))
const { DeliveryInspector } = await import('../src/admin/DeliveryInspectorField')

const options = normalizePluginOptions({ data: { redact: ['payload.phone'] } })
const delivery = (status: string, extra: Record<string, unknown> = {}) => ({
  id: 'd1',
  status,
  channel: 'email',
  event: 'order.paid',
  eventId: 'e1',
  trigger: 'order-paid',
  attempts: 3,
  maxAttempts: 3,
  recipientId: 'u1',
  recipientKey: 'user:u1',
  templateSlug: 'order.paid',
  idempotencyKey: 'idem-1',
  destination: 'alex@example.com',
  context: {
    payload: { orderId: 'O1', phone: '+911234567890', password: 'x' },
    recipient: { id: 'u1', name: 'Alex', email: 'alex@example.com', phone: '+919876543210' },
  },
  ...extra,
})

const seed = (status: string) =>
  createMemoryPayload({
    'notification-deliveries': [
      delivery(status),
      { id: 'd2', status: 'queued', channel: 'sms', fallbackOf: 'd1' },
    ],
    'notification-logs': [
      {
        id: 'l1',
        delivery: 'd1',
        attempt: 1,
        status: 'failed',
        outcome: 'retryable',
        error: 'SMTP timeout',
        durationMs: 30000,
        providerResponse: { provider: 'payload-email', raw: { code: 421, token: 'secret' } },
      },
    ],
  })

describe('deliveries admin', () => {
  it('lists the actions a status allows', () => {
    expect(deliveryActions({ status: 'failed' })).toEqual({
      canRetry: true,
      canCancel: false,
      retryNeedsConfirmation: false,
    })
    expect(deliveryActions({ status: 'unknown' }).retryNeedsConfirmation).toBe(true)
    expect(deliveryActions({ status: 'queued' })).toEqual({
      canRetry: false,
      canCancel: true,
      retryNeedsConfirmation: false,
    })
    expect(deliveryActions({ status: 'sent' })).toEqual({
      canRetry: false,
      canCancel: false,
      retryNeedsConfirmation: false,
    })
  })

  it('inspects attempts, fallbacks and the redacted context, hiding the destination', async () => {
    const memory = seed('failed')
    const result = await inspectDelivery(memory.payload, options, delivery('failed') as never)
    expect(result.delivery).not.toHaveProperty('destination')
    expect(result.delivery).not.toHaveProperty('context')
    expect(result.context).toEqual({
      payload: { orderId: 'O1', phone: '[redacted]', password: '[redacted]' },
      // Shown masked, like the delivery's destination.
      recipient: {
        id: 'u1',
        name: 'Alex',
        email: 'a***@example.com',
        phone: expect.stringMatching(/^\+91\*+3210$/),
      },
    })
    expect(result.attempts[0]).toMatchObject({
      attempt: 1,
      error: 'SMTP timeout',
      provider: 'payload-email',
    })
    expect(result.attempts[0].providerResponse).toEqual({ code: 421, token: '[redacted]' })
    expect(result.fallbacks).toEqual([{ id: 'd2', channel: 'sms', status: 'queued' }])
  })

  it('retries a failed delivery on the same record with one more attempt', async () => {
    const memory = seed('failed')
    expect(await retryDelivery(memory.payload, options, delivery('failed') as never)).toEqual({
      ok: true,
    })
    expect(memory.docs('notification-deliveries')[0]).toMatchObject({
      status: 'queued',
      maxAttempts: 4,
      idempotencyKey: 'idem-1',
    })
    const job = (
      memory.queue.mock.calls[0] as unknown as [{ input: Record<string, unknown>; task: string }]
    )[0]
    expect(job.task).toBe('notification:send')
    expect(job.input.deliveryId).toBe('d1')
  })

  it('asks before retrying an unknown outcome and refuses final deliveries', async () => {
    const memory = seed('unknown')
    const refused = await retryDelivery(memory.payload, options, delivery('unknown') as never)
    expect(refused).toMatchObject({ ok: false, status: 409 })
    expect(
      await retryDelivery(memory.payload, options, delivery('unknown') as never, {
        confirmUnknown: true,
      }),
    ).toEqual({ ok: true })
    expect(await retryDelivery(memory.payload, options, delivery('sent') as never)).toMatchObject({
      ok: false,
    })
  })

  it('cancels planned or queued deliveries only', async () => {
    const memory = seed('queued')
    expect(await cancelDelivery(memory.payload, options, delivery('queued') as never)).toEqual({
      ok: true,
    })
    expect(memory.docs('notification-deliveries')[0]).toMatchObject({ status: 'cancelled' })
    expect(
      await cancelDelivery(memory.payload, options, delivery('sending') as never),
    ).toMatchObject({ ok: false, status: 409 })
  })

  it('guards the endpoints with viewDeliveries / retryDeliveries and record access', async () => {
    const findByID = mock(async ({ overrideAccess }: { overrideAccess: boolean }) =>
      overrideAccess ? delivery('failed') : null,
    )
    const request = (user: unknown) =>
      ({ user, routeParams: { id: 'd1' }, payload: { findByID }, json: async () => ({}) }) as never
    const [inspect, retry] = deliveryEndpoints(() =>
      normalizePluginOptions({ access: { retryDeliveries: () => false } }),
    )
    expect((await inspect.handler(request(null))).status).toBe(401)
    // The caller's access (e.g. another tenant) hides the record.
    expect((await inspect.handler(request({ id: 'a' }))).status).toBe(404)
    expect((await retry.handler(request({ id: 'a' }))).status).toBe(403)
  })

  it('renders attempts and the actions', () => {
    const html = renderToString(
      <DeliveryInspector
        data={{
          delivery: { status: 'failed', lastError: 'SMTP timeout' },
          context: { payload: { orderId: 'O1' } },
          attempts: [
            {
              id: 'l1',
              attempt: 1,
              status: 'failed',
              provider: 'payload-email',
              durationMs: 120,
              error: 'SMTP timeout',
            },
          ],
          fallbacks: [],
          actions: { canRetry: true, canCancel: false, retryNeedsConfirmation: false },
        }}
        onAction={() => {}}
      />,
    ).replaceAll('<!-- -->', '')
    expect(html).toContain('Status <strong>failed</strong> · SMTP timeout')
    expect(html).toContain('>Retry</button>')
    expect(html).not.toContain('Cancel delivery')
    expect(html).toContain('120 ms')
  })
})
