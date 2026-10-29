'use client'

import React, { useCallback, useEffect, useState } from 'react'
import { useDocumentInfo } from '@payloadcms/ui'
import { STUDIO_CSS } from './studio/styles'

type Attempt = {
  id: string | number
  at?: string
  attempt?: number
  status?: string
  outcome?: string
  error?: string
  durationMs?: number
  provider?: string
  providerMessageId?: string
  providerResponse?: unknown
}

export type DeliveryInspection = {
  delivery: Record<string, unknown>
  context: Record<string, unknown> | null
  attempts: Attempt[]
  fallbacks: Array<{ id: string | number; channel: string; status: string }>
  actions: { canRetry: boolean; canCancel: boolean; retryNeedsConfirmation: boolean }
}

export const RETRY_UNKNOWN_WARNING =
  'The provider did not confirm this send, so the message may already have been delivered. Retry anyway?'

/** Attempts, context and actions for one delivery. */
export const DeliveryInspector: React.FC<{
  data: DeliveryInspection
  onAction: (action: 'retry' | 'cancel', body?: Record<string, unknown>) => void
  busy?: boolean
  confirm?: (message: string) => boolean
}> = ({ data, onAction, busy, confirm = (message) => window.confirm(message) }) => {
  const { actions, attempts, fallbacks, context, delivery } = data
  return (
    <div className="pn-properties">
      <div className="pn-panel-title">Delivery</div>
      <div className="pn-toolbar">
        <span>
          Status <strong>{String(delivery.status)}</strong>
          {delivery.skipReason ? ` · ${String(delivery.skipReason)}` : ''}
          {delivery.lastError ? ` · ${String(delivery.lastError)}` : ''}
        </span>
        {actions.canRetry ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (actions.retryNeedsConfirmation && !confirm(RETRY_UNKNOWN_WARNING)) return
              onAction('retry', actions.retryNeedsConfirmation ? { confirmUnknown: true } : {})
            }}
          >
            Retry
          </button>
        ) : null}
        {actions.canCancel ? (
          <button
            type="button"
            className="pn-danger"
            disabled={busy}
            onClick={() => {
              if (confirm('Cancel this delivery? It will not be sent.')) onAction('cancel')
            }}
          >
            Cancel delivery
          </button>
        ) : null}
      </div>

      <div className="pn-panel-title">Attempts</div>
      {attempts.length ? (
        <table className="pn-versions">
          <thead>
            <tr>
              <th>#</th>
              <th>When</th>
              <th>Status</th>
              <th>Provider</th>
              <th>Time</th>
              <th>Error / response</th>
            </tr>
          </thead>
          <tbody>
            {attempts.map((attempt) => (
              <tr key={attempt.id}>
                <td>{attempt.attempt ?? ''}</td>
                <td>{attempt.at ? new Date(attempt.at).toLocaleString() : ''}</td>
                <td>
                  {attempt.status}
                  {attempt.outcome ? ` (${attempt.outcome})` : ''}
                </td>
                <td>
                  {attempt.provider ?? ''}
                  {attempt.providerMessageId ? ` · ${attempt.providerMessageId}` : ''}
                </td>
                <td>{attempt.durationMs !== undefined ? `${attempt.durationMs} ms` : ''}</td>
                <td>
                  {attempt.error ?? ''}
                  {attempt.providerResponse ? (
                    <details>
                      <summary>Response</summary>
                      <pre className="pn-code-preview">
                        {JSON.stringify(attempt.providerResponse, null, 2)}
                      </pre>
                    </details>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="pn-hint">No attempts yet.</p>
      )}

      {fallbacks.length ? (
        <p className="pn-hint">
          Fallbacks:{' '}
          {fallbacks.map((entry) => `${entry.channel} (${entry.status}) #${entry.id}`).join(', ')}
        </p>
      ) : null}

      <details>
        <summary className="pn-panel-title">Context (redacted)</summary>
        <pre className="pn-code-preview">{JSON.stringify(context, null, 2)}</pre>
      </details>
    </div>
  )
}

/** Payload admin UI field on notification-deliveries. */
export const DeliveryInspectorField: React.FC<{
  field?: { admin?: { custom?: { apiRoute?: string } } }
  collectionSlug?: string
}> = (props) => {
  const { id, collectionSlug } = useDocumentInfo()
  const base = (props.field?.admin?.custom?.apiRoute || '/api').replace(/\/$/, '')
  const slug = collectionSlug || props.collectionSlug || 'notification-deliveries'
  const [data, setData] = useState<DeliveryInspection | null>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (id === undefined) return
    const res = await fetch(`${base}/${slug}/${id}/inspect`, { credentials: 'include' })
    const body = (await res.json()) as DeliveryInspection & { error?: string }
    if (res.ok) setData(body)
    else setMessage(body.error || `Could not load the delivery (${res.status})`)
  }, [base, slug, id])

  useEffect(() => {
    void load()
  }, [load])

  const act = async (action: 'retry' | 'cancel', body: Record<string, unknown> = {}) => {
    setBusy(true)
    setMessage('')
    try {
      const res = await fetch(`${base}/${slug}/${id}/${action}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const result = (await res.json()) as { error?: string }
      setMessage(
        res.ok
          ? action === 'retry'
            ? 'Queued for another attempt'
            : 'Cancelled'
          : result.error || 'Failed',
      )
      await load()
    } finally {
      setBusy(false)
    }
  }

  if (id === undefined) return null
  return (
    <div className="pn-studio">
      <style>{STUDIO_CSS}</style>
      {message ? (
        <p className="pn-hint" role="status">
          {message}
        </p>
      ) : null}
      {data ? (
        <DeliveryInspector
          data={data}
          busy={busy}
          onAction={(action, body) => void act(action, body)}
        />
      ) : null}
    </div>
  )
}

export default DeliveryInspectorField
