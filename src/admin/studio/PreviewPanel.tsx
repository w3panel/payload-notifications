'use client'

import React, { useCallback, useState } from 'react'
import type { NotificationChannel } from '../../types'
import type { EmailCheck } from '../../studio/audit'
import {
  buildPreviewBody,
  buildTemplateApiPath,
  CHANNEL_OPTIONS,
  DEFAULT_PREVIEW_CONTEXT,
  PREVIEW_WIDTHS,
  previewSrcDoc,
  type PreviewSampleChoice,
} from '../previewHelpers'
import { ChannelPreview, type RenderedPreview } from './ChannelPreview'

type PreviewPanelProps = {
  getDoc: () => Record<string, unknown>
  collectionSlug: string
  apiRoute: string
  /** Rendered after the preview (test send controls). */
  children?: (state: {
    channel: NotificationChannel
    sample: PreviewSampleChoice
    contextJson: string
  }) => React.ReactNode
}

type SampleKind = PreviewSampleChoice['kind']

type PreviewResult = {
  channel: NotificationChannel
  rendered?: RenderedPreview
  checks?: EmailCheck[]
  error?: string
}

const CHANNEL_LABELS: Record<NotificationChannel, string> = {
  email: 'Email',
  sms: 'SMS',
  whatsapp: 'WhatsApp',
  inapp: 'In-app',
  push: 'Push',
}

/** Previewable channels the template has. */
export const templateChannels = (doc: Record<string, unknown>): NotificationChannel[] =>
  Array.isArray(doc.channels)
    ? CHANNEL_OPTIONS.filter((channel) => (doc.channels as unknown[]).includes(channel))
    : []

const EmailPreview: React.FC<{
  rendered: RenderedPreview
  checks: EmailCheck[]
  dark: boolean
  device: keyof typeof PREVIEW_WIDTHS
}> = ({ rendered, checks, dark, device }) => (
  <div style={{ display: 'grid', gap: 6 }}>
    {checks.length ? (
      <ul className="pn-checks" aria-label="Email checks">
        {checks.map((check, index) => (
          <li key={index} className={check.level === 'error' ? 'pn-error' : 'pn-warning'}>
            {check.level === 'error' ? 'Error: ' : 'Warning: '}
            {check.message}
          </li>
        ))}
      </ul>
    ) : null}
    <div className="pn-email-meta">
      <div>
        <span className="pn-label">Subject</span> {rendered.subject || '(none)'}
      </div>
      {rendered.preheader ? (
        <div>
          <span className="pn-label">Preheader</span> {rendered.preheader}
        </div>
      ) : null}
    </div>
    {rendered.html ? (
      <iframe
        title="Email preview"
        sandbox=""
        className="pn-preview-frame"
        srcDoc={previewSrcDoc(rendered.html, { dark })}
        style={{ width: PREVIEW_WIDTHS[device], height: 640 }}
      />
    ) : (
      <pre className="pn-code-preview">{rendered.text}</pre>
    )}
  </div>
)

/** Preview controls: channel, sample data, device width, dark mode, and the checks. */
export const PreviewPanel: React.FC<PreviewPanelProps> = ({
  getDoc,
  collectionSlug,
  apiRoute,
  children,
}) => {
  const [channel, setChannel] = useState<NotificationChannel | 'all'>('email')
  const [kind, setKind] = useState<SampleKind>('event')
  const [contextJson, setContextJson] = useState(DEFAULT_PREVIEW_CONTEXT)
  const [collection, setCollection] = useState('')
  const [documentId, setDocumentId] = useState('')
  const [trigger, setTrigger] = useState('')
  const [device, setDevice] = useState<keyof typeof PREVIEW_WIDTHS>('desktop')
  const [dark, setDark] = useState(false)
  const [results, setResults] = useState<PreviewResult[]>([])
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)

  const sample: PreviewSampleChoice =
    kind === 'document'
      ? { kind, collection, id: documentId }
      : kind === 'trigger'
        ? { kind, trigger, documentId }
        : { kind }

  const runPreview = useCallback(async () => {
    const doc = getDoc()
    const channels = channel === 'all' ? templateChannels(doc) : [channel]
    if (!channels.length) {
      setStatus('Choose the template channels first')
      return
    }
    const requests = channels.map((entry) => ({
      channel: entry,
      request: buildPreviewBody({ channel: entry, doc, contextJson, sample }),
    }))
    const invalid = requests.find((entry) => !entry.request.ok)
    if (invalid && !invalid.request.ok) {
      setStatus(invalid.request.error)
      return
    }
    setBusy(true)
    setStatus('')
    try {
      const next = await Promise.all(
        requests.map(async ({ channel: entry, request }): Promise<PreviewResult> => {
          const res = await fetch(buildTemplateApiPath(collectionSlug, 'preview', apiRoute), {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(request.ok ? request.body : {}),
          })
          const data = (await res.json()) as {
            error?: string
            errors?: string[]
            rendered?: RenderedPreview
            checks?: EmailCheck[]
          }
          return res.ok
            ? { channel: entry, rendered: data.rendered ?? {}, checks: data.checks ?? [] }
            : {
                channel: entry,
                error: [
                  data.error || `Preview failed (${res.status})`,
                  ...(data.errors ?? []),
                ].join(' — '),
              }
        }),
      )
      setResults(next)
      setStatus('Preview updated')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Preview request failed')
    } finally {
      setBusy(false)
    }
    // `sample` is derived from the inputs listed here.
  }, [
    apiRoute,
    channel,
    collectionSlug,
    contextJson,
    getDoc,
    kind,
    collection,
    documentId,
    trigger,
  ])

  const showsEmail = channel === 'email' || channel === 'all'

  return (
    <div className="pn-preview" style={{ display: 'grid', gap: '0.6rem' }}>
      <div className="pn-panel-title">Preview</div>
      <div className="pn-toolbar">
        <label className="pn-check">
          Channel
          <select
            value={channel}
            onChange={(event) => setChannel(event.target.value as NotificationChannel)}
            style={{ width: 'auto' }}
          >
            <option value="all">All template channels</option>
            {CHANNEL_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        <label className="pn-check">
          Sample data
          <select
            value={kind}
            onChange={(event) => setKind(event.target.value as SampleKind)}
            style={{ width: 'auto' }}
          >
            <option value="event">Event sample</option>
            <option value="document">Real document</option>
            <option value="trigger">Trigger test data</option>
            <option value="json">Custom JSON</option>
          </select>
        </label>
        <button type="button" disabled={busy} onClick={() => void runPreview()}>
          {busy ? 'Rendering…' : 'Preview'}
        </button>
        {showsEmail ? (
          <>
            <span className="pn-tabs" role="group" aria-label="Width">
              {(Object.keys(PREVIEW_WIDTHS) as Array<keyof typeof PREVIEW_WIDTHS>).map((name) => (
                <button
                  key={name}
                  type="button"
                  className={device === name ? 'pn-active' : ''}
                  aria-pressed={device === name}
                  onClick={() => setDevice(name)}
                >
                  {name === 'desktop' ? 'Desktop' : 'Mobile'}
                </button>
              ))}
            </span>
            <label className="pn-check">
              <input
                type="checkbox"
                checked={dark}
                onChange={(event) => setDark(event.target.checked)}
              />
              Dark mode
            </label>
          </>
        ) : null}
      </div>

      {kind === 'json' ? (
        <label className="pn-field">
          <span className="pn-label">Context (JSON)</span>
          <textarea
            className="pn-mono"
            rows={8}
            value={contextJson}
            onChange={(event) => setContextJson(event.target.value)}
          />
        </label>
      ) : null}
      {kind === 'document' ? (
        <div className="pn-row">
          <label className="pn-field" style={{ flex: 1 }}>
            <span className="pn-label">Collection (from collectionEvents)</span>
            <input
              value={collection}
              placeholder="orders"
              onChange={(event) => setCollection(event.target.value)}
            />
          </label>
          <label className="pn-field" style={{ flex: 1 }}>
            <span className="pn-label">Document ID</span>
            <input value={documentId} onChange={(event) => setDocumentId(event.target.value)} />
          </label>
        </div>
      ) : null}
      {kind === 'trigger' ? (
        <div className="pn-row">
          <label className="pn-field" style={{ flex: 1 }}>
            <span className="pn-label">Trigger slug</span>
            <input value={trigger} onChange={(event) => setTrigger(event.target.value)} />
          </label>
          <label className="pn-field" style={{ flex: 1 }}>
            <span className="pn-label">Document ID (collection triggers)</span>
            <input value={documentId} onChange={(event) => setDocumentId(event.target.value)} />
          </label>
        </div>
      ) : null}
      {kind === 'event' ? (
        <p className="pn-hint">
          Uses the sample payload registered for this template&apos;s event.
        </p>
      ) : null}

      {status ? (
        <p className="pn-hint" role="status">
          {status}
        </p>
      ) : null}

      <div className="pn-channel-grid">
        {results.map((result) => (
          <section
            key={result.channel}
            className="pn-channel-result"
            aria-label={`${result.channel} preview`}
          >
            {results.length > 1 ? (
              <div className="pn-panel-title">{CHANNEL_LABELS[result.channel]}</div>
            ) : null}
            {result.error ? (
              <p className="pn-problems" role="alert">
                {result.error}
              </p>
            ) : result.channel === 'email' ? (
              <EmailPreview
                rendered={result.rendered ?? {}}
                checks={result.checks ?? []}
                dark={dark}
                device={device}
              />
            ) : (
              <ChannelPreview channel={result.channel} rendered={result.rendered ?? {}} />
            )}
          </section>
        ))}
      </div>

      {children?.({ channel: channel === 'all' ? 'email' : channel, sample, contextJson })}
    </div>
  )
}
