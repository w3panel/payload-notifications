/**
 * How a failed send should be treated:
 * - `retryable`: safe to try again (rate limits, 5xx, connection refused)
 * - `permanent`: will not succeed (invalid number, rejected content, 4xx)
 * - `unknown`: the provider may or may not have sent it (timeouts, dropped
 *   connections) — never retried automatically, left for reconciliation
 */
export type SendFailureKind = 'retryable' | 'permanent' | 'unknown'

/** Full outcome taxonomy recorded on attempt logs. */
export type DeliveryOutcome =
  | 'sent'
  | 'stored'
  | SendFailureKind
  | 'policy'
  | 'duplicate'
  | 'cancelled'
  | 'skipped'

/** Thrown by providers to say how a failure should be treated. */
export class ProviderError extends Error {
  readonly kind: SendFailureKind
  readonly status?: number
  readonly code?: string

  constructor(
    message: string,
    { kind, status, code }: { kind?: SendFailureKind; status?: number; code?: string } = {},
  ) {
    super(message)
    this.name = 'ProviderError'
    this.status = status
    this.code = code
    this.kind = kind ?? (status !== undefined ? kindForStatus(status) : 'permanent')
  }
}

/** HTTP status → failure kind: 408 / 5xx are ambiguous or transient, 429 retryable, other 4xx permanent. */
export const kindForStatus = (status: number): SendFailureKind => {
  if (status === 429 || status === 502 || status === 503) return 'retryable'
  if (status === 408 || status === 504 || status >= 500) return 'unknown'
  return 'permanent'
}

/** Thrown when a provider call exceeds `providers.timeoutMs`. */
export class ProviderTimeoutError extends ProviderError {
  constructor(timeoutMs: number) {
    super(`Provider did not respond within ${timeoutMs} ms`, { kind: 'unknown' })
    this.name = 'ProviderTimeoutError'
  }
}

const UNKNOWN = /timed? ?out|timeout|etimedout|socket hang up|econnreset|aborted|epipe/i
const RETRYABLE =
  /rate.?limit|too many requests|\b429\b|\b502\b|\b503\b|unavailable|temporar|econnrefused|enotfound|eai_again/i

/** Classifies a send error. Ambiguous failures are `unknown`, never `retryable`. */
export const classifySendFailure = (error: unknown): SendFailureKind => {
  if (error instanceof ProviderError) return error.kind
  const message = error instanceof Error ? `${error.name} ${error.message}` : String(error)
  if (UNKNOWN.test(message)) return 'unknown'
  if (RETRYABLE.test(message)) return 'retryable'
  return 'permanent'
}
