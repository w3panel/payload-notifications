'use client'

import React, { useEffect, useState } from 'react'
import { NotificationsOverview, type OverviewProps } from './NotificationsOverview'
import { ProvidersSettings } from './ProvidersSettings'
import { STUDIO_CSS } from './studio/styles'

type Tab = 'overview' | 'settings'

/** Notifications section on the Payload dashboard (`admin.dashboard`). */
export const NotificationsDashboard: React.FC<OverviewProps & { initialTab?: Tab }> = ({
  initialTab = 'overview',
  ...props
}) => {
  const [tab, setTab] = useState<Tab>(initialTab)

  // Nav links open a tab through the URL hash (#notifications-settings).
  useEffect(() => {
    const fromHash = () => {
      if (window.location.hash === '#notifications-settings') setTab('settings')
      else if (window.location.hash === '#notifications-overview') setTab('overview')
    }
    fromHash()
    window.addEventListener('hashchange', fromHash)
    return () => window.removeEventListener('hashchange', fromHash)
  }, [])
  return (
    <section
      className="pn-studio pn-dashboard"
      id="notifications-overview"
      aria-label="Notifications"
    >
      <style>{STUDIO_CSS}</style>
      <span id="notifications-settings" aria-hidden="true" />
      <div className="pn-toolbar">
        <h2 style={{ margin: '0 12px 0 0' }}>Notifications</h2>
        <span className="pn-tabs" role="tablist">
          {(
            [
              ['overview', 'Overview'],
              ['settings', 'Providers & settings'],
            ] as Array<[Tab, string]>
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={tab === value}
              className={tab === value ? 'pn-active' : ''}
              onClick={() => setTab(value)}
            >
              {label}
            </button>
          ))}
        </span>
      </div>
      {tab === 'overview' ? (
        <NotificationsOverview {...props} />
      ) : (
        <ProvidersSettings apiRoute={props.apiRoute} />
      )}
    </section>
  )
}

export default NotificationsDashboard
