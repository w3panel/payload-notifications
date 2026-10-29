'use client'

import React from 'react'
import type { NotificationChannel, RenderedNotificationContent } from '../../types'

export type RenderedPreview = Partial<RenderedNotificationContent>

/** Characters left in the current SMS segment. */
export const segmentRemainder = (segments: RenderedPreview['segments']): number | undefined => {
  if (!segments) return undefined
  const single = segments.encoding === 'GSM-7' ? 160 : 70
  const multi = segments.encoding === 'GSM-7' ? 153 : 67
  if (segments.segments <= 1) return single - segments.characters
  return segments.segments * multi - segments.characters
}

const Phone: React.FC<{ title: string; children: React.ReactNode; tone: 'sms' | 'whatsapp' }> = ({
  title,
  children,
  tone,
}) => (
  <div className={`pn-phone pn-phone-${tone}`} aria-label={`${title} preview`}>
    <div className="pn-phone-bar">{title}</div>
    <div className="pn-phone-screen">{children}</div>
  </div>
)

const SmsPreview: React.FC<{ rendered: RenderedPreview }> = ({ rendered }) => {
  const text = rendered.body || rendered.text || ''
  const segments = rendered.segments
  const left = segmentRemainder(segments)
  return (
    <div className="pn-channel">
      <Phone title="SMS" tone="sms">
        <div className="pn-bubble pn-bubble-sms">{text || <em>No SMS body</em>}</div>
      </Phone>
      {segments ? (
        <p className={`pn-hint${segments.segments > 2 ? ' pn-warning-text' : ''}`}>
          {segments.characters} characters · {segments.encoding} · {segments.segments} segment
          {segments.segments === 1 ? '' : 's'}
          {left !== undefined ? ` · ${left} left in this segment` : ''}
          {segments.encoding === 'UCS-2'
            ? ' · Unicode characters (emoji, some accents) cut each segment to 70 characters'
            : ''}
        </p>
      ) : null}
    </div>
  )
}

const WhatsAppPreview: React.FC<{ rendered: RenderedPreview }> = ({ rendered }) => {
  const template = rendered.whatsappTemplate
  const text = rendered.body || rendered.text || ''
  return (
    <div className="pn-channel">
      <Phone title="WhatsApp" tone="whatsapp">
        {template ? (
          <div className="pn-bubble pn-bubble-whatsapp">
            <div className="pn-label">
              Approved template <code>{template.name}</code> ({template.language})
              {template.status ? ` · ${template.status}` : ''}
            </div>
            {template.parameters?.length ? (
              <ol className="pn-hsm-params">
                {template.parameters.map((value, index) => (
                  <li key={index}>
                    <code>{`{{${index + 1}}}`}</code> {value || <em>(empty)</em>}
                  </li>
                ))}
              </ol>
            ) : (
              <em>No parameters</em>
            )}
          </div>
        ) : (
          <div className="pn-bubble pn-bubble-whatsapp">{text || <em>No WhatsApp body</em>}</div>
        )}
      </Phone>
      {template ? (
        <p className="pn-hint">
          WhatsApp shows the approved template text with these values; outside the 24-hour window
          only approved templates are delivered.
        </p>
      ) : rendered.segments ? (
        <p className="pn-hint">{rendered.segments.characters} characters</p>
      ) : null}
    </div>
  )
}

const InAppPreview: React.FC<{ rendered: RenderedPreview }> = ({ rendered }) => {
  const icon = rendered.icon
  const isUrl = Boolean(icon && /^https?:\/\//i.test(icon))
  return (
    <div className="pn-channel">
      <div className="pn-inapp-card" aria-label="In-app preview">
        <div className="pn-inapp-icon" aria-hidden="true">
          {isUrl ? <img src={icon} alt="" /> : (icon || '🔔').slice(0, 2)}
        </div>
        <div className="pn-inapp-body">
          <div className="pn-inapp-title">
            {rendered.title || <em>No title</em>}
            {rendered.priority && rendered.priority !== 'normal' ? (
              <span className={`pn-badge pn-badge-${rendered.priority}`}>{rendered.priority}</span>
            ) : null}
          </div>
          <div>{rendered.body || rendered.text}</div>
          {rendered.actionUrl ? (
            <div className="pn-inapp-action" title={rendered.actionUrl}>
              Opens {rendered.actionUrl}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

/** Channel-native previews of rendered SMS, WhatsApp and in-app content. */
export const ChannelPreview: React.FC<{
  channel: NotificationChannel
  rendered: RenderedPreview
}> = ({ channel, rendered }) => {
  switch (channel) {
    case 'sms':
      return <SmsPreview rendered={rendered} />
    case 'whatsapp':
      return <WhatsAppPreview rendered={rendered} />
    case 'inapp':
      return <InAppPreview rendered={rendered} />
    default:
      return <pre className="pn-code-preview">{rendered.text || rendered.body}</pre>
  }
}
