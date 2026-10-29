'use client'

import React, { useCallback, useEffect, useState } from 'react'

export type CodeTriggerSummary = {
  slug: string
  name?: string
  origin: 'code' | 'rule'
  source:
    | { type: 'event'; event: string }
    | { type: 'collection'; collection: string; operation: string }
  enabled: boolean
  policy: 'independent' | 'managed' | 'enforced'
  overridable: string[]
  deliveries: Array<{ channel: string; template: string; recipient?: string }>
  override: { id: string | number; slug: string; status: string } | null
}

const cell: React.CSSProperties = {
  padding: '6px 8px',
  borderBottom: '1px solid var(--theme-elevation-100, #eee)',
  textAlign: 'left',
  fontSize: 13,
}

const POLICY_LABELS: Record<CodeTriggerSummary['policy'], string> = {
  independent: 'Independent — admin triggers run alongside',
  managed: 'Managed — can be customized',
  enforced: '🔒 Enforced — read-only',
}

const describeSource = (source: CodeTriggerSummary['source']) =>
  source.type === 'event' ? source.event : `${source.collection} · ${source.operation}`

/** Table of code-defined triggers, shown above the admin trigger list. */
export const CodeTriggersTable: React.FC<{
  triggers: CodeTriggerSummary[]
  onCustomize: (slug: string) => void
  editHref: (id: string | number) => string
  busy?: boolean
}> = ({ triggers, onCustomize, editHref, busy }) => (
  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
    <thead>
      <tr>
        <th style={cell}>Trigger</th>
        <th style={cell}>Source</th>
        <th style={cell}>Deliveries</th>
        <th style={cell}>Policy</th>
        <th style={cell} />
      </tr>
    </thead>
    <tbody>
      {triggers.map((trigger) => (
        <tr key={trigger.slug}>
          <td style={cell}>
            <strong>{trigger.name || trigger.slug}</strong>
            <div style={{ opacity: 0.7, fontSize: 12 }}>
              {trigger.slug}
              {trigger.origin === 'rule' ? ' · legacy rule' : ''}
              {trigger.enabled ? '' : ' · disabled'}
            </div>
          </td>
          <td style={cell}>
            <code>{describeSource(trigger.source)}</code>
          </td>
          <td style={cell}>
            {trigger.deliveries
              .map((delivery) => `${delivery.channel}: ${delivery.template}`)
              .join(', ')}
          </td>
          <td style={cell}>{POLICY_LABELS[trigger.policy]}</td>
          <td style={cell}>
            {trigger.override ? (
              <a href={editHref(trigger.override.id)}>Customized ({trigger.override.status})</a>
            ) : trigger.policy === 'managed' ? (
              <button type="button" disabled={busy} onClick={() => onCustomize(trigger.slug)}>
                Customize
              </button>
            ) : null}
          </td>
        </tr>
      ))}
    </tbody>
  </table>
)

/**
 * Collection `beforeList` component for notification-triggers: lists triggers
 * defined in code with their precedence policy and a Customize action for
 * managed ones.
 */
export const CodeTriggersList: React.FC<{ apiRoute?: string }> = ({ apiRoute = '/api' }) => {
  const [triggers, setTriggers] = useState<CodeTriggerSummary[]>([])
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let active = true
    fetch(`${apiRoute}/payload-notifications/code-triggers`, { credentials: 'include' })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Could not load code triggers (${res.status})`)
        return (await res.json()) as { triggers: CodeTriggerSummary[] }
      })
      .then((body) => active && setTriggers(body.triggers))
      .catch(
        (caught: unknown) =>
          active && setError(caught instanceof Error ? caught.message : String(caught)),
      )
    return () => {
      active = false
    }
  }, [apiRoute])

  const editHref = useCallback(
    (id: string | number) =>
      typeof window === 'undefined'
        ? `./${id}`
        : `${window.location.pathname.replace(/\/$/, '')}/${id}`,
    [],
  )

  const customize = useCallback(
    async (slug: string) => {
      setBusy(true)
      try {
        const res = await fetch(
          `${apiRoute}/payload-notifications/code-triggers/${encodeURIComponent(slug)}/customize`,
          { method: 'POST', credentials: 'include' },
        )
        const body = (await res.json()) as { id?: string | number; error?: string }
        if (body.id !== undefined) window.location.assign(editHref(body.id))
        else setError(body.error || `Customize failed (${res.status})`)
      } finally {
        setBusy(false)
      }
    },
    [apiRoute, editHref],
  )

  if (!triggers.length && !error) return null

  return (
    <details style={{ margin: '0 0 16px' }} open>
      <summary style={{ fontWeight: 600, cursor: 'pointer' }}>
        Triggers defined in code ({triggers.length})
      </summary>
      {error ? <p style={{ color: 'var(--theme-error-500, #c00)' }}>{error}</p> : null}
      <CodeTriggersTable
        triggers={triggers}
        onCustomize={customize}
        editHref={editHref}
        busy={busy}
      />
    </details>
  )
}

export default CodeTriggersList
