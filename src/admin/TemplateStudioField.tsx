'use client'

import React, { useCallback, useState } from 'react'
import { useField, useForm } from '@payloadcms/ui'
import type { EmailDesign } from '../studio/model'
import { STUDIO_CSS } from './studio/styles'
import { useDesignerLists } from './studio/useDesignerLists'
import { useTemplateVariables } from './studio/useTemplateVariables'
import { VisualEmailEditor } from './studio/VisualEmailEditor'
import {
  buildTemplateApiPath,
  CHANNEL_OPTIONS,
  DEFAULT_PREVIEW_CONTEXT,
  parsePreviewContext,
} from './previewHelpers'
import { TemplateEngineHelp } from './TemplateEngineHelp'
import type { NotificationChannel } from '../types'

type StudioInnerProps = {
  getDoc: () => Record<string, unknown>
  collectionSlug?: string
  apiRoute?: string
}

const StudioInner: React.FC<StudioInnerProps> = ({
  getDoc,
  collectionSlug = 'notification-templates',
  apiRoute = '/api',
}) => {
  const [channel, setChannel] = useState<NotificationChannel>('email')
  const [contextJson, setContextJson] = useState(DEFAULT_PREVIEW_CONTEXT)
  const [userId, setUserId] = useState('')
  const [previewResult, setPreviewResult] = useState('')
  const [previewHtml, setPreviewHtml] = useState('')
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)

  const runPreview = useCallback(async () => {
    const parsed = parsePreviewContext(contextJson)
    if (!parsed.ok) {
      setStatus(parsed.error)
      return
    }

    setBusy(true)
    setStatus('')
    try {
      const res = await fetch(buildTemplateApiPath(collectionSlug, 'preview', apiRoute), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel,
          doc: getDoc(),
          context: parsed.value,
        }),
      })
      const data = (await res.json()) as {
        error?: string
        rendered?: {
          subject?: string
          title?: string
          text?: string
          body?: string
          html?: string
        }
      }
      if (!res.ok) {
        setStatus(data.error || `Preview failed (${res.status})`)
        setPreviewResult('')
        setPreviewHtml('')
        return
      }

      const rendered = data.rendered || {}
      setPreviewResult(
        [
          rendered.subject ? `Subject: ${rendered.subject}` : null,
          rendered.title ? `Title: ${rendered.title}` : null,
          rendered.text || rendered.body || '',
        ]
          .filter(Boolean)
          .join('\n'),
      )
      setPreviewHtml(rendered.html || '')
      setStatus('Preview updated')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Preview request failed')
    } finally {
      setBusy(false)
    }
  }, [apiRoute, channel, collectionSlug, contextJson, getDoc])

  const runTestSend = useCallback(async () => {
    const parsed = parsePreviewContext(contextJson)
    if (!parsed.ok) {
      setStatus(parsed.error)
      return
    }
    if (!userId.trim()) {
      setStatus('Enter a userId for test send')
      return
    }

    setBusy(true)
    setStatus('')
    try {
      const doc = getDoc()
      const res = await fetch(buildTemplateApiPath(collectionSlug, 'test-send', apiRoute), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel,
          userId: userId.trim(),
          doc,
          id: doc.id,
          context: parsed.value.payload || parsed.value,
        }),
      })
      const data = (await res.json()) as {
        error?: string
        result?: { status?: string; reason?: string }
      }
      if (!res.ok) {
        setStatus(data.error || `Test send failed (${res.status})`)
        return
      }
      setStatus(
        `Test send: ${data.result?.status || 'ok'}${data.result?.reason ? ` — ${data.result.reason}` : ''}`,
      )
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Test send request failed')
    } finally {
      setBusy(false)
    }
  }, [apiRoute, channel, collectionSlug, contextJson, getDoc, userId])

  return (
    <div style={{ display: 'grid', gap: '0.75rem', marginTop: '0.5rem' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
        <label style={{ fontSize: 13 }}>
          Channel{' '}
          <select
            value={channel}
            onChange={(event) => setChannel(event.target.value as NotificationChannel)}
          >
            {CHANNEL_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        <button type="button" disabled={busy} onClick={() => void runPreview()}>
          Preview
        </button>
        <button type="button" disabled={busy} onClick={() => void runTestSend()}>
          Send test
        </button>
      </div>

      <label style={{ display: 'grid', gap: 4, fontSize: 13 }}>
        Sample context (JSON)
        <textarea
          value={contextJson}
          onChange={(event) => setContextJson(event.target.value)}
          rows={8}
          style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12 }}
        />
      </label>

      <label style={{ display: 'grid', gap: 4, fontSize: 13 }}>
        Test-send userId
        <input
          value={userId}
          onChange={(event) => setUserId(event.target.value)}
          placeholder="user id"
        />
      </label>

      {status ? <p style={{ margin: 0, fontSize: 13 }}>{status}</p> : null}

      {previewResult ? (
        <pre
          style={{
            margin: 0,
            padding: '0.75rem',
            background: 'var(--theme-elevation-50, #f6f6f6)',
            borderRadius: 4,
            whiteSpace: 'pre-wrap',
            fontSize: 12,
          }}
        >
          {previewResult}
        </pre>
      ) : null}

      {previewHtml ? (
        <iframe
          title="Email HTML preview"
          sandbox=""
          srcDoc={previewHtml}
          style={{
            width: '100%',
            minHeight: 180,
            border: '1px solid var(--theme-elevation-150, #ddd)',
            borderRadius: 4,
            background: '#fff',
          }}
        />
      ) : null}

      <TemplateEngineHelp />
    </div>
  )
}

type TemplateStudioFieldProps = {
  path?: string
  field?: {
    admin?: {
      custom?: {
        collectionSlug?: string
        apiRoute?: string
        partialsSlug?: string
        mediaSlug?: string
      }
    }
  }
}

/**
 * Payload admin UI field: live preview + test-send for notification templates.
 */
export const TemplateStudioField: React.FC<TemplateStudioFieldProps> = (props) => {
  const custom = props.field?.admin?.custom
  const collectionSlug = custom?.collectionSlug || 'notification-templates'
  const apiRoute = custom?.apiRoute || '/api'
  // Read form values lazily on Preview / Send test rather than subscribing to every change.
  const { getData } = useForm()
  const getDoc = useCallback(() => {
    const data = getData()
    return data && typeof data === 'object' ? data : {}
  }, [getData])

  const editor = useField<string>({ path: 'email.editor' })
  const design = useField<EmailDesign | null>({ path: 'email.design' })
  const slug = useField<string>({ path: 'slug' })
  const [trigger, setTrigger] = useState('')
  const visual = editor.value === 'visual'
  const lists = useDesignerLists({
    apiRoute,
    partialsSlug: visual ? custom?.partialsSlug : undefined,
    mediaSlug: visual ? custom?.mediaSlug : undefined,
  })
  const variables = useTemplateVariables({
    apiRoute,
    collectionSlug,
    event: slug.value || undefined,
    trigger: trigger.trim() || undefined,
  })

  return (
    <div className="pn-studio">
      <style>{STUDIO_CSS}</style>
      <div style={{ fontWeight: 600 }}>Template studio</div>
      {visual ? (
        <>
          <div className="pn-toolbar">
            <span className="pn-hint">
              Variables for event <code>{slug.value || '(set a slug)'}</code>
              {variables.paths.length ? ` · ${variables.paths.length} available` : ''}
              {variables.error ? ` · ${variables.error}` : ''}
            </span>
            <label className="pn-check">
              Trigger
              <input
                value={trigger}
                placeholder="optional trigger slug"
                onChange={(event) => setTrigger(event.target.value)}
                style={{ width: 180 }}
              />
            </label>
          </div>
          <VisualEmailEditor
            design={design.value}
            onChange={(next) => design.setValue(next)}
            variables={variables.paths}
            roots={variables.roots}
            partials={lists.partials}
            media={lists.media}
          />
        </>
      ) : null}
      <StudioInner collectionSlug={collectionSlug} apiRoute={apiRoute} getDoc={getDoc} />
    </div>
  )
}

export default TemplateStudioField
