import type { NotificationProvider, ProviderSendInput, ProviderSendResult } from '../types'
import {
  classifySendFailure,
  ProviderTimeoutError,
  type SendFailureKind,
} from '../providers/errors'

export type ProviderCallResult =
  | { ok: true; result: ProviderSendResult; durationMs: number }
  | { ok: false; kind: SendFailureKind; message: string; durationMs: number; error: unknown }

/**
 * Calls a provider with a timeout. A timeout aborts the provider's signal and
 * is reported as `unknown`: the message may already have been accepted.
 */
export const callProvider = async (
  provider: NotificationProvider,
  input: Omit<ProviderSendInput, 'signal'>,
  timeoutMs: number,
  now: () => number = Date.now,
): Promise<ProviderCallResult> => {
  const started = now()
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort()
      reject(new ProviderTimeoutError(timeoutMs))
    }, timeoutMs)
  })

  try {
    const result = await Promise.race([
      provider.send({ ...input, signal: controller.signal }),
      timeout,
    ])
    return { ok: true, result, durationMs: now() - started }
  } catch (error) {
    return {
      ok: false,
      kind: classifySendFailure(error),
      message: error instanceof Error ? error.message : String(error),
      durationMs: now() - started,
      error,
    }
  } finally {
    clearTimeout(timer)
  }
}
