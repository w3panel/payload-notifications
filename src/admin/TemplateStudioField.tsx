'use client'

import React, { useCallback, useState } from 'react'
import { useDocumentInfo, useField, useForm, useFormModified } from '@payloadcms/ui'
import type { EmailDesign } from '../studio/model'
import { STUDIO_CSS } from './studio/styles'
import { useDesignerLists } from './studio/useDesignerLists'
import { useTemplateVariables } from './studio/useTemplateVariables'
import { VisualEmailEditor } from './studio/VisualEmailEditor'
import { buildTemplateApiPath, parsePreviewContext } from './previewHelpers'
import { CodeVariablesPanel } from './studio/CodeVariablesPanel'
import { EditorModeBar } from './studio/EditorModeBar'
import { useMonacoVariableCompletion } from './studio/monacoVariables'
import { PreviewPanel } from './studio/PreviewPanel'
import { VersionsPanel } from './studio/VersionsPanel'
import { TemplateEngineHelp } from './TemplateEngineHelp'
import type { NotificationChannel } from '../types'

type TestSendProps = {
  getDoc: () => Record<string, unknown>
  collectionSlug: string
  apiRoute: string
  channel: NotificationChannel
  contextJson: string
}

/** Sends the current form values once to a user (marked as a test). */
const TestSend: React.FC<TestSendProps> = ({
  getDoc,
  collectionSlug,
  apiRoute,
  channel,
  contextJson,
}) => {
  const [userId, setUserId] = useState('')
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)

  const run = async () => {
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
      setStatus(
        res.ok
          ? `Test send: ${data.result?.status || 'ok'}${data.result?.reason ? ` — ${data.result.reason}` : ''}`
          : data.error || `Test send failed (${res.status})`,
      )
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Test send request failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="pn-row">
      <label className="pn-field" style={{ flex: 1 }}>
        <span className="pn-label">Test-send userId</span>
        <input
          value={userId}
          onChange={(event) => setUserId(event.target.value)}
          placeholder="user id"
        />
      </label>
      <button type="button" disabled={busy} onClick={() => void run()}>
        Send test
      </button>
      {status ? (
        <span className="pn-hint" role="status">
          {status}
        </span>
      ) : null}
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
        templateVersionsSlug?: string
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
  const channels = useField<string[]>({ path: 'channels' })
  const htmlBody = useField<string>({ path: 'email.htmlBody' })
  const textBody = useField<string>({ path: 'email.textBody' })
  const subject = useField<string>({ path: 'email.subject' })
  const preheader = useField<string>({ path: 'email.preheader' })
  const hasEmail = Array.isArray(channels.value) && channels.value.includes('email')
  const { id } = useDocumentInfo()
  const modified = useFormModified()
  const status = useField<string>({ path: 'status' })
  const publishedVersion = useField<number>({ path: 'version' })
  const unpublished = useField<boolean>({ path: 'hasUnpublishedChanges' })
  useMonacoVariableCompletion(variables.paths, hasEmail && !visual)

  const compile = useCallback(
    async (next: EmailDesign) => {
      const res = await fetch(`${apiRoute.replace(/\/$/, '')}/${collectionSlug}/compile-design`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ design: next, locale: getDoc().locale }),
      })
      const data = (await res.json()) as {
        html?: string
        text?: string
        error?: string
        errors?: string[]
      }
      return res.ok && typeof data.html === 'string'
        ? { html: data.html, text: data.text ?? '' }
        : {
            error: [data.error || `Conversion failed (${res.status})`, ...(data.errors ?? [])].join(
              ' — ',
            ),
          }
    },
    [apiRoute, collectionSlug, getDoc],
  )

  return (
    <div className="pn-studio">
      <style>{STUDIO_CSS}</style>
      <div style={{ fontWeight: 600 }}>Template studio</div>
      {hasEmail ? (
        <EditorModeBar
          editor={editor.value}
          design={design.value}
          setEditor={(value) => editor.setValue(value)}
          setDesign={(next) => design.setValue(next)}
          setBodies={({ html, text }) => {
            htmlBody.setValue(html)
            textBody.setValue(text)
          }}
          compile={compile}
        />
      ) : null}
      {hasEmail && !visual ? (
        <CodeVariablesPanel
          paths={variables.paths}
          roots={variables.roots}
          sources={[subject.value, preheader.value, htmlBody.value, textBody.value]}
        />
      ) : null}
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
      <PreviewPanel getDoc={getDoc} collectionSlug={collectionSlug} apiRoute={apiRoute}>
        {({ channel, contextJson }) => (
          <TestSend
            getDoc={getDoc}
            collectionSlug={collectionSlug}
            apiRoute={apiRoute}
            channel={channel}
            contextJson={contextJson}
          />
        )}
      </PreviewPanel>
      <VersionsPanel
        apiRoute={apiRoute}
        collectionSlug={collectionSlug}
        versionsSlug={custom?.templateVersionsSlug || 'notification-template-versions'}
        id={id}
        status={status.value}
        version={publishedVersion.value}
        hasUnpublishedChanges={unpublished.value}
        modified={modified}
        getDoc={getDoc}
        compile={(next) => compile(next as EmailDesign)}
      />
      <TemplateEngineHelp />
    </div>
  )
}

export default TemplateStudioField
