import { describe, expect, it, mock } from 'bun:test'
import { normalizePluginOptions } from '../src/config/normalizePluginOptions'
import { callProvider } from '../src/deliveries/providerCall'
import { classifySendFailure, ProviderError } from '../src/providers/errors'
import { createResendEmailProvider, resendIdempotencyKey } from '../src/providers/resend'

const options = normalizePluginOptions({})
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const providerWith = (response: () => Response | Promise<Response>) => {
  const fetch = mock(async (_url: string, _init: RequestInit) => response())
  return {
    fetch,
    provider: createResendEmailProvider({
      apiKey: 're_test',
      from: 'Electrofit <orders@electrofit.ae>',
      fetch: fetch as unknown as typeof globalThis.fetch,
    }),
  }
}

const input = {
  to: 'customer@example.com',
  channel: 'email' as const,
  content: { subject: 'Order EF-1 confirmed', body: 'Confirmed', html: '<p>Confirmed</p>' },
  idempotencyKey: 'evt_k_order:1:confirmed:2::order-confirmed::user:1::email::order.confirmed',
  payload: {} as never,
  options,
}

describe('Resend email provider', () => {
  it('sends with the delivery key as Idempotency-Key', async () => {
    const { provider, fetch } = providerWith(() => json(200, { id: 'em_1' }))
    const call = await callProvider(provider, input, 5000)
    expect(call).toMatchObject({
      ok: true,
      result: { status: 'accepted', providerMessageId: 'em_1' },
    })
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.resend.com/emails')
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toBe(input.idempotencyKey)
    expect(JSON.parse(String(init.body))).toMatchObject({
      from: 'Electrofit <orders@electrofit.ae>',
      to: ['customer@example.com'],
      subject: 'Order EF-1 confirmed',
    })
  })

  it('hashes keys longer than 256 characters', async () => {
    const long = 'k'.repeat(300)
    const hashed = await resendIdempotencyKey(long)
    expect(hashed).toStartWith('sha256:')
    expect(hashed.length).toBeLessThanOrEqual(256)
    expect(await resendIdempotencyKey(long)).toBe(hashed)
    expect(await resendIdempotencyKey('short')).toBe('short')
  })

  it('retries 429 and 5xx, fails 422 permanently', async () => {
    const cases: Array<[number, string]> = [
      [429, 'retryable'],
      [500, 'retryable'],
      [503, 'retryable'],
      [422, 'permanent'],
    ]
    for (const [status, kind] of cases) {
      const { provider } = providerWith(() =>
        json(status, { statusCode: status, name: 'error', message: 'x' }),
      )
      const call = await callProvider(provider, input, 5000)
      expect(call.ok ? 'ok' : call.kind).toBe(kind)
    }
  })

  it('treats 409 concurrent requests as retryable and key reuse as permanent', async () => {
    const concurrent = providerWith(() =>
      json(409, { statusCode: 409, name: 'concurrent_idempotent_requests', message: 'x' }),
    )
    const reused = providerWith(() =>
      json(409, { statusCode: 409, name: 'invalid_idempotent_request', message: 'x' }),
    )
    const a = await callProvider(concurrent.provider, input, 5000)
    const b = await callProvider(reused.provider, input, 5000)
    expect(a.ok ? 'ok' : a.kind).toBe('retryable')
    expect(b.ok ? 'ok' : b.kind).toBe('permanent')
  })

  it('retries timeouts because Resend deduplicates the key', async () => {
    const { provider } = providerWith(() => new Promise<Response>(() => undefined))
    const call = await callProvider(provider, input, 5)
    expect(call.ok ? 'ok' : call.kind).toBe('retryable')
  })

  it('leaves timeouts unknown without a key', async () => {
    const { provider } = providerWith(() => new Promise<Response>(() => undefined))
    const call = await callProvider(provider, { ...input, idempotencyKey: undefined }, 5)
    expect(call.ok ? 'ok' : call.kind).toBe('unknown')
  })

  it('maps status lookups', async () => {
    const { provider } = providerWith(() => json(200, { id: 'em_1', last_event: 'bounced' }))
    expect(await provider.getStatus?.('em_1')).toEqual({
      providerMessageId: 'em_1',
      status: 'failed',
      suppress: true,
      error: 'Email bounced',
    })
  })
})

describe('classifySendFailure with HTTP status on adapter errors', () => {
  it('uses status / statusCode before message text', () => {
    expect(
      classifySendFailure(Object.assign(new Error('Error sending email'), { status: 429 })),
    ).toBe('retryable')
    expect(
      classifySendFailure(Object.assign(new Error('Error sending email'), { statusCode: 422 })),
    ).toBe('permanent')
    expect(classifySendFailure(new ProviderError('x', { kind: 'unknown' }))).toBe('unknown')
  })
})
