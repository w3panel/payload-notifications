'use client'

import React, { useEffect, useState } from 'react'
import type { settingsSnapshot } from '../admin-ops/settings'

export type SettingsSnapshot = ReturnType<typeof settingsSnapshot>

const Row: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <tr>
    <th>{label}</th>
    <td>{value}</td>
  </tr>
)

const yes = (value: boolean) => (value ? 'Yes' : 'No')

/** Provider status cards and read-only settings (tested without fetching). */
export const SettingsBody: React.FC<{
  settings: SettingsSnapshot
  onTest?: (channel: string) => void
  results?: Record<string, { ok: boolean; message: string } | 'running'>
}> = ({ settings, onTest, results = {} }) => (
  <div style={{ display: 'grid', gap: 12 }}>
    <div className="pn-overview-grid">
      {settings.providers.map((provider) => {
        const result = results[provider.channel]
        return (
          <section
            key={provider.channel}
            className={`pn-tile${provider.problems.length ? ' pn-tile-bad' : ''}`}
          >
            <div className="pn-panel-title">
              {provider.channel} · {provider.provider ?? 'not configured'}
              {provider.source === 'custom' ? ' (custom)' : ''}
            </div>
            {provider.credentials.length ? (
              <div className="pn-legend">
                {provider.credentials.map((credential) => (
                  <span key={credential.name} className={credential.set ? '' : 'pn-error'}>
                    {credential.set ? '✓' : '✗'} {credential.name}
                  </span>
                ))}
              </div>
            ) : null}
            {provider.problems.length ? (
              <ul className="pn-problems">
                {provider.problems.map((problem) => (
                  <li key={problem}>{problem}</li>
                ))}
              </ul>
            ) : (
              <p className="pn-hint">Configuration looks complete.</p>
            )}
            {provider.webhookUrl ? (
              <p className="pn-hint">
                Status webhook: <code>{provider.webhookUrl}</code>
              </p>
            ) : null}
            {onTest && provider.source !== 'none' ? (
              <div className="pn-toolbar">
                <button
                  type="button"
                  disabled={result === 'running'}
                  onClick={() => onTest(provider.channel)}
                >
                  {result === 'running' ? 'Testing…' : 'Test connection'}
                </button>
                {result && result !== 'running' ? (
                  <span className={result.ok ? 'pn-hint' : 'pn-error'} role="status">
                    {result.ok ? '✓ ' : '✗ '}
                    {result.message}
                  </span>
                ) : null}
              </div>
            ) : null}
          </section>
        )
      })}
    </div>
    <p className="pn-hint">
      These settings come from the plugin configuration in code. Secrets are read from your
      environment and are never shown here.
    </p>
    <table className="pn-versions pn-settings">
      <tbody>
        <Row label="Channels" value={settings.channels.join(', ')} />
        <Row label="Jobs queue" value={<code>{settings.jobs.queue}</code>} />
        <Row label="Provider timeout" value={`${settings.providerTimeoutMs} ms`} />
        <Row
          label="Retries"
          value={`${settings.reliability.attempts} attempts (max ${settings.reliability.maxAttempts}), ${settings.reliability.backoff.type} backoff from ${settings.reliability.backoff.delayMs} ms`}
        />
        <Row
          label="Stale sends become unknown after"
          value={`${settings.reliability.staleSendingMinutes} min`}
        />
        <Row label="Reconcile schedule" value={settings.maintenance.reconcileCron ?? 'off'} />
        <Row
          label="Retention"
          value={
            settings.maintenance.retentionCron
              ? `${settings.maintenance.retentionCron} · logs ${settings.maintenance.retention.logsDays ?? '∞'} d, deliveries ${settings.maintenance.retention.deliveriesDays ?? '∞'} d, events ${settings.maintenance.retention.eventsDays ?? '∞'} d`
              : 'off'
          }
        />
        <Row label="Events inbox" value={yes(settings.eventsInbox)} />
        <Row
          label="Preferences"
          value={`${settings.preferences.mode}; mandatory: ${settings.preferences.mandatoryCategories.join(', ') || 'none'}; marketing opt-in required: ${yes(settings.preferences.marketingRequiresOptIn)}; unsubscribe links: ${yes(settings.preferences.unsubscribeLinks)}`}
        />
        <Row
          label="Quiet hours"
          value={
            settings.quietHours
              ? `${settings.quietHours.start}–${settings.quietHours.end} ${settings.quietHours.timezone} (${settings.quietHours.classifications.join(', ')})`
              : 'off'
          }
        />
        <Row
          label="Tenancy"
          value={
            settings.tenancy
              ? `${settings.tenancy.field} (users: ${settings.tenancy.userField})`
              : 'off'
          }
        />
        <Row
          label="Webhooks"
          value={`${settings.webhooks.baseUrl ?? 'set serverURL or webhooks.publicUrl'} · Twilio signatures ${yes(settings.webhooks.twilioSignature)} · Meta signatures ${yes(settings.webhooks.metaSignature)}`}
        />
        <Row label="Store rendered content in logs" value={yes(settings.logs.storeRendered)} />
      </tbody>
    </table>
  </div>
)

/** Providers & settings tab of the notifications dashboard. */
export const ProvidersSettings: React.FC<{ apiRoute?: string }> = ({ apiRoute = '/api' }) => {
  const base = apiRoute.replace(/\/$/, '')
  const [settings, setSettings] = useState<SettingsSnapshot | null>(null)
  const [error, setError] = useState('')
  const [results, setResults] = useState<
    Record<string, { ok: boolean; message: string } | 'running'>
  >({})

  useEffect(() => {
    const controller = new AbortController()
    fetch(`${base}/payload-notifications/settings`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (res) => {
        const body = (await res.json()) as SettingsSnapshot & { error?: string }
        if (!res.ok) throw new Error(body.error || `Settings failed (${res.status})`)
        setSettings(body)
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted)
          setError(reason instanceof Error ? reason.message : String(reason))
      })
    return () => controller.abort()
  }, [base])

  const test = async (channel: string) => {
    setResults((current) => ({ ...current, [channel]: 'running' }))
    try {
      const res = await fetch(`${base}/payload-notifications/providers/${channel}/test`, {
        method: 'POST',
        credentials: 'include',
      })
      const body = (await res.json()) as { ok?: boolean; message?: string; error?: string }
      setResults((current) => ({
        ...current,
        [channel]: {
          ok: res.ok && Boolean(body.ok),
          message: body.message || body.error || `HTTP ${res.status}`,
        },
      }))
    } catch (reason) {
      setResults((current) => ({
        ...current,
        [channel]: {
          ok: false,
          message: reason instanceof Error ? reason.message : String(reason),
        },
      }))
    }
  }

  if (error) return <p className="pn-problems">{error}</p>
  return settings ? (
    <SettingsBody settings={settings} onTest={(channel) => void test(channel)} results={results} />
  ) : null
}
