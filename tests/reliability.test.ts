import { describe, expect, it } from 'bun:test'
import {
  buildDeliveryFingerprint,
  classifyDispatchFailure,
  createObservabilityEvent,
} from '../src/reliability'

describe('reliability helpers', () => {
  it('builds deterministic delivery fingerprints', () => {
    const result = buildDeliveryFingerprint({
      userId: 'user_1',
      channel: 'email',
      template: 'order.paid',
      event: 'order.paid',
      idempotencyKey: 'evt_123',
    })

    expect(result).toBe('user_1::email::order.paid::order.paid::evt_123')
  })

  it('classifies transient failures as retriable', () => {
    const result = classifyDispatchFailure(new Error('Provider timeout while sending'))
    expect(result.classification).toBe('retriable')
  })

  it('classifies string failure messages as retriable', () => {
    const result = classifyDispatchFailure('Provider timeout while sending')
    expect(result.classification).toBe('retriable')
  })

  it('classifies validation failures as terminal', () => {
    const result = classifyDispatchFailure(new Error('Template set not found'))
    expect(result.classification).toBe('terminal')
  })

  it('creates structured observability events', () => {
    const result = createObservabilityEvent({
      input: {
        userId: 'user_1',
        channel: 'sms',
        template: 'order.shipped',
        event: 'order.shipped',
        idempotencyKey: 'evt_456',
      },
      result: {
        channel: 'sms',
        status: 'sent',
        provider: 'twilio',
        providerMessageId: 'msg_1',
      },
    })

    expect(result.type).toBe('notification.dispatch')
    expect(result.providerMessageId).toBe('msg_1')
  })
})
