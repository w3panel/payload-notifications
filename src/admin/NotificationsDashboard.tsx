'use client'

import React, { useState } from 'react'
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
  return (
    <section
      className="pn-studio pn-dashboard"
      id="notifications-overview"
      aria-label="Notifications"
    >
      <style>{STUDIO_CSS}</style>
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
