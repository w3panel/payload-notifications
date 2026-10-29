'use client'

import React from 'react'

/** Nav links to the notifications dashboard tabs (`admin.navLinks`). */
export const NotificationsNavLinks: React.FC<{ adminRoute?: string }> = ({
  adminRoute = '/admin',
}) => {
  const base = adminRoute.replace(/\/$/, '') || '/'
  return (
    <nav aria-label="Notifications" style={{ display: 'grid', gap: 4, padding: '8px 0' }}>
      <a className="nav__link" href={`${base}#notifications-overview`}>
        Notifications overview
      </a>
      <a className="nav__link" href={`${base}#notifications-settings`}>
        Providers &amp; settings
      </a>
    </nav>
  )
}

export default NotificationsNavLinks
