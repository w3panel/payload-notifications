'use client'

import React from 'react'
import { NotificationsOverview, type OverviewProps } from './NotificationsOverview'
import { STUDIO_CSS } from './studio/styles'

/** Notifications section on the Payload dashboard (`admin.dashboard`). */
export const NotificationsDashboard: React.FC<OverviewProps> = (props) => (
  <section
    className="pn-studio pn-dashboard"
    id="notifications-overview"
    aria-label="Notifications"
  >
    <style>{STUDIO_CSS}</style>
    <h2 style={{ margin: 0 }}>Notifications</h2>
    <NotificationsOverview {...props} />
  </section>
)

export default NotificationsDashboard
