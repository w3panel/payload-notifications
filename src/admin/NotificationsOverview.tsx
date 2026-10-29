'use client'

import React, { useEffect, useState } from 'react'
import type { NotificationStats } from '../admin-ops/stats'

export type OverviewProps = {
  apiRoute?: string
  adminRoute?: string
  deliveriesSlug?: string
}

const STATUS_COLORS: Record<string, string> = {
  delivered: '#15803d',
  sent: '#22c55e',
  queued: '#3b82f6',
  planned: '#93c5fd',
  sending: '#6366f1',
  unknown: '#f59e0b',
  failed: '#dc2626',
  skipped: '#a1a1aa',
  cancelled: '#71717a',
}

const percent = (value: number | null) => (value === null ? '—' : `${Math.round(value * 100)}%`)

const Tile: React.FC<{ label: string; value: React.ReactNode; tone?: 'bad' | 'warn' }> = ({
  label,
  value,
  tone,
}) => (
  <div className={`pn-tile${tone ? ` pn-tile-${tone}` : ''}`}>
    <div className="pn-tile-value">{value}</div>
    <div className="pn-label">{label}</div>
  </div>
)

/** Stacked bars of deliveries per day by status. */
export const DailyChart: React.FC<{ daily: NotificationStats['deliveries']['daily'] }> = ({
  daily,
}) => {
  const max = Math.max(
    1,
    ...daily.map((day) => Object.values(day.byStatus).reduce((a, b) => a + b, 0)),
  )
  if (!daily.length) return <p className="pn-hint">No deliveries in this period.</p>
  return (
    <div className="pn-chart" role="img" aria-label="Deliveries per day by status">
      {daily.map((day) => {
        const total = Object.values(day.byStatus).reduce((a, b) => a + b, 0)
        return (
          <div key={day.date} className="pn-chart-col" title={`${day.date}: ${total}`}>
            <div className="pn-chart-bar" style={{ height: `${(total / max) * 100}%` }}>
              {Object.entries(day.byStatus).map(([status, count]) => (
                <div
                  key={status}
                  style={{ flexGrow: count, background: STATUS_COLORS[status] ?? '#a1a1aa' }}
                  title={`${status}: ${count}`}
                />
              ))}
            </div>
            <div className="pn-chart-label">{day.date.slice(5)}</div>
          </div>
        )
      })}
    </div>
  )
}

/** The overview body (tested without fetching). */
export const OverviewBody: React.FC<{
  stats: NotificationStats
  deliveryHref: (id: string | number) => string
}> = ({ stats, deliveryHref }) => {
  const failed = (stats.deliveries.byStatus.failed ?? 0) + (stats.deliveries.byStatus.unknown ?? 0)
  const sent = (stats.deliveries.byStatus.sent ?? 0) + (stats.deliveries.byStatus.delivered ?? 0)
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div className="pn-tiles">
        <Tile
          label={stats.events.source === 'inbox' ? 'Events received' : 'Events with deliveries'}
          value={stats.events.received}
        />
        <Tile label="Trigger match rate" value={percent(stats.events.matchRate)} />
        <Tile label="Deliveries" value={stats.deliveries.total} />
        <Tile label="Sent / delivered" value={sent} />
        <Tile label="Failed / unknown" value={failed} tone={failed ? 'bad' : undefined} />
        <Tile
          label={`Queue "${stats.queue.name}"`}
          value={stats.queue.pending ?? '—'}
          tone={stats.queue.pending && stats.queue.pending > 100 ? 'warn' : undefined}
        />
      </div>
      {stats.sampled ? (
        <p className="pn-hint">Large period: counts are based on the latest records only.</p>
      ) : null}
      <DailyChart daily={stats.deliveries.daily} />
      <div className="pn-legend">
        {Object.entries(stats.deliveries.byStatus).map(([status, count]) => (
          <span key={status}>
            <i style={{ background: STATUS_COLORS[status] ?? '#a1a1aa' }} /> {status} {count}
          </span>
        ))}
        {Object.entries(stats.deliveries.byChannel).map(([channel, count]) => (
          <span key={channel} className="pn-hint">
            {channel}: {count}
          </span>
        ))}
      </div>
      <div className="pn-overview-grid">
        <section>
          <div className="pn-panel-title">Recent failures</div>
          {stats.recentFailures.length ? (
            <ul className="pn-list-plain">
              {stats.recentFailures.map((failure) => (
                <li key={failure.id}>
                  <a href={deliveryHref(failure.id)}>
                    {failure.trigger} · {failure.channel}
                  </a>{' '}
                  <span className="pn-hint">
                    {failure.status}
                    {failure.error ? ` — ${failure.error}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="pn-hint">None 🎉</p>
          )}
        </section>
        <section>
          <div className="pn-panel-title">Skip reasons</div>
          {stats.skipReasons.length ? (
            <ul className="pn-list-plain">
              {stats.skipReasons.map((entry) => (
                <li key={entry.reason}>
                  {entry.reason} <span className="pn-hint">× {entry.count}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="pn-hint">No skipped deliveries.</p>
          )}
        </section>
        <section>
          <div className="pn-panel-title">Providers</div>
          {stats.providers.length ? (
            <table className="pn-versions">
              <thead>
                <tr>
                  <th>Provider</th>
                  <th>Attempts</th>
                  <th>Failures</th>
                  <th>Avg</th>
                  <th>p95</th>
                </tr>
              </thead>
              <tbody>
                {stats.providers.map((provider) => (
                  <tr
                    key={provider.provider}
                    className={provider.failureRate > 0.2 ? 'pn-error' : undefined}
                  >
                    <td>{provider.provider}</td>
                    <td>{provider.attempts}</td>
                    <td>
                      {provider.failures} ({percent(provider.failureRate)})
                    </td>
                    <td>{provider.avgMs === null ? '—' : `${provider.avgMs} ms`}</td>
                    <td>{provider.p95Ms === null ? '—' : `${provider.p95Ms} ms`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="pn-hint">No send attempts yet.</p>
          )}
        </section>
      </div>
    </div>
  )
}

/** Notifications overview for the Payload dashboard. */
export const NotificationsOverview: React.FC<OverviewProps> = ({
  apiRoute = '/api',
  adminRoute = '/admin',
  deliveriesSlug = 'notification-deliveries',
}) => {
  const [days, setDays] = useState(7)
  const [stats, setStats] = useState<NotificationStats | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    fetch(`${apiRoute.replace(/\/$/, '')}/payload-notifications/stats?days=${days}`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (res) => {
        const body = (await res.json()) as NotificationStats & { error?: string }
        if (!res.ok) throw new Error(body.error || `Stats failed (${res.status})`)
        setStats(body)
        setError('')
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted)
          setError(reason instanceof Error ? reason.message : String(reason))
      })
    return () => controller.abort()
  }, [apiRoute, days])

  // Users without viewDeliveries get 403; the panel then stays out of the way.
  if (error === 'Forbidden') return null
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div className="pn-toolbar">
        <span className="pn-hint">Last</span>
        {[1, 7, 30].map((value) => (
          <button
            key={value}
            type="button"
            className={days === value ? 'pn-active' : ''}
            aria-pressed={days === value}
            onClick={() => setDays(value)}
          >
            {value === 1 ? '24 h' : `${value} days`}
          </button>
        ))}
      </div>
      {error ? <p className="pn-problems">{error}</p> : null}
      {stats ? (
        <OverviewBody
          stats={stats}
          deliveryHref={(id) =>
            `${adminRoute.replace(/\/$/, '')}/collections/${deliveriesSlug}/${id}`
          }
        />
      ) : null}
    </div>
  )
}
