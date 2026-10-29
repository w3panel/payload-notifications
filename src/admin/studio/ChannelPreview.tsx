'use client'

import React from 'react'
import type { NotificationChannel } from '../../types'

export type RenderedPreview = {
  subject?: string
  preheader?: string
  title?: string
  text?: string
  body?: string
  html?: string
  actionUrl?: string
  icon?: string
  priority?: string
  segments?: { segments: number; encoding: string; characters: number }
  whatsappTemplate?: { name: string; language?: string; parameters?: string[] }
}

/** Rendered SMS, WhatsApp and in-app content. */
export const ChannelPreview: React.FC<{
  channel: NotificationChannel
  rendered: RenderedPreview
}> = ({ rendered }) => (
  <pre className="pn-code-preview">
    {[rendered.title, rendered.text || rendered.body].filter(Boolean).join('\n\n')}
  </pre>
)
