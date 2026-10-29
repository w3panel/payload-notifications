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

/** Preview controls: channel, sample data, device width, dark mode, and the checks. */
export const PreviewPanel: React.FC<PreviewPanelProps> = ({
  getDoc,
  collectionSlug,
  apiRoute,
  children,
}) => {
  const [channel, setChannel] = useState<NotificationChannel>('email')
  const [kind, setKind] = useState<SampleKind>('event')
  const [contextJson, setContextJson] = useState(DEFAULT_PREVIEW_CONTEXT)
  const [collection, setCollection] = useState('')
  const [documentId, setDocumentId] = useState('')
  const [trigger, setTrigger] = useState('')
  const [device, setDevice] = useState<keyof typeof PREVIEW_WIDTHS>('desktop')
  const [dark, setDark] = useState(false)
  const [rendered, setRendered] = useState<RenderedPreview | null>(null)
  const [checks, setChecks] = useState<EmailCheck[]>([])
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)

  const sample: PreviewSampleChoice =
    kind === 'document'
      ? { kind, collection, id: documentId }
      : kind === 'trigger'
        ? { kind, trigger, documentId }
        : { kind }

  const runPreview = useCallback(async () => {
    const request = buildPreviewBody({ channel, doc: getDoc(), contextJson, sample })
    if (!request.ok) {
      setStatus(request.error)
      return
    }
    setBusy(true)
    setStatus('')
    try {
      const res = await fetch(buildTemplateApiPath(collectionSlug, 'preview', apiRoute), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request.body),
      })
      const data = (await res.json()) as {
        error?: string
        errors?: string[]
        rendered?: RenderedPreview
        checks?: EmailCheck[]
      }
      if (!res.ok) {
        setStatus(
          [data.error || `Preview failed (${res.status})`, ...(data.errors ?? [])].join(' — '),
        )
        setRendered(null)
        setChecks([])
        return
      }
      setRendered(data.rendered ?? null)
      setChecks(data.checks ?? [])
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
        {channel === 'email' ? (
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

      {rendered ? (
        channel === 'email' ? (
          <div style={{ display: 'grid', gap: 6 }}>
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
        ) : (
          <ChannelPreview channel={channel} rendered={rendered} />
        )
      ) : null}

      {children?.({ channel, sample, contextJson })}
    </div>
  )
}
