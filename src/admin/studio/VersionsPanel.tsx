'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { collapseDiff, diffTemplateContent, type FieldDiff } from '../../studio/diff'
import { previewSrcDoc } from '../previewHelpers'

type VersionDoc = {
  id: string | number
  version: number
  locale?: string | null
  publishedAt?: string
  content: Record<string, unknown>
}

type VersionsPanelProps = {
  apiRoute: string
  collectionSlug: string
  versionsSlug: string
  id?: string | number
  status?: string
  version?: number
  hasUnpublishedChanges?: boolean
  /** True when the form has unsaved edits (publish uses the saved document). */
  modified?: boolean
  getDoc: () => Record<string, unknown>
  /** Compiles the draft's visual design so its HTML can be compared. */
  compile?: (design: unknown) => Promise<{ html: string; text: string } | { error: string }>
  /** Called after publish / rollback (reloads the document by default). */
  onChanged?: () => void
  confirm?: (message: string) => boolean
}

const DRAFT = 'draft'

/** Content of the current form values in the shape of a version snapshot. */
export const draftContent = (doc: Record<string, unknown>): Record<string, unknown> => ({
  channels: doc.channels,
  email: doc.email,
  sms: doc.sms,
  whatsapp: doc.whatsapp,
  inapp: doc.inapp,
  variables: doc.variables,
})

/** A version snapshot as a template document for the preview endpoint (renders its stored HTML). */
export const versionPreviewDoc = (
  slug: unknown,
  content: Record<string, unknown>,
): Record<string, unknown> => ({
  slug,
  ...content,
  ...(content.email && typeof content.email === 'object'
    ? { email: { ...(content.email as Record<string, unknown>), editor: 'code' } }
    : {}),
})

const DiffView: React.FC<{ diffs: FieldDiff[] }> = ({ diffs }) =>
  diffs.length ? (
    <div className="pn-diff">
      {diffs.map((diff) => (
        <details key={diff.path} open={diff.path !== 'email.htmlBody'}>
          <summary>{diff.label}</summary>
          <pre className="pn-diff-lines">
            {collapseDiff(diff.lines).map((line, index) =>
              line.type === 'gap' ? (
                <div key={index} className="pn-diff-gap">
                  … {line.count} unchanged line{line.count === 1 ? '' : 's'}
                </div>
              ) : (
                <div key={index} className={`pn-diff-${line.type}`}>
                  {line.type === 'added' ? '+ ' : line.type === 'removed' ? '- ' : '  '}
                  {line.text}
                </div>
              ),
            )}
          </pre>
        </details>
      ))}
    </div>
  ) : (
    <p className="pn-hint">No differences.</p>
  )

/** Publish controls, version history, diffs and rollback for a template. */
export const VersionsPanel: React.FC<VersionsPanelProps> = ({
  apiRoute,
  collectionSlug,
  versionsSlug,
  id,
  status,
  version,
  hasUnpublishedChanges,
  modified,
  getDoc,
  compile,
  onChanged = () => window.location.reload(),
  confirm = (message) => window.confirm(message),
}) => {
  const base = apiRoute.replace(/\/$/, '')
  const [versions, setVersions] = useState<VersionDoc[]>([])
  const [left, setLeft] = useState<string>('')
  const [right, setRight] = useState<string>(DRAFT)
  const [diffs, setDiffs] = useState<FieldDiff[] | null>(null)
  const [frames, setFrames] = useState<{ left?: string; right?: string } | null>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (id === undefined) return
    const controller = new AbortController()
    const params = new URLSearchParams({
      'where[template][equals]': String(id),
      sort: '-version',
      limit: '50',
      depth: '0',
    })
    fetch(`${base}/${versionsSlug}?${params}`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then((res) => (res.ok ? res.json() : { docs: [] }))
      .then((data: { docs?: VersionDoc[] }) => {
        const docs = data.docs ?? []
        setVersions(docs)
        if (docs[0]) setLeft(String(docs[0].version))
      })
      .catch(() => undefined)
    return () => controller.abort()
  }, [base, versionsSlug, id])

  const contentFor = useCallback(
    async (key: string): Promise<Record<string, unknown> | undefined> => {
      if (key !== DRAFT) return versions.find((entry) => String(entry.version) === key)?.content
      const content = draftContent(getDoc())
      const email = content.email as Record<string, unknown> | undefined
      // A visual draft's HTML is only generated on save; compile it to compare.
      if (email?.editor === 'visual' && email.design && compile) {
        const compiled = await compile(email.design)
        if (!('error' in compiled)) {
          content.email = { ...email, htmlBody: compiled.html, textBody: compiled.text }
        }
      }
      return content
    },
    [versions, getDoc, compile],
  )

  const label = (key: string) => (key === DRAFT ? 'Current draft' : `Version ${key}`)

  const compare = async () => {
    setBusy(true)
    setMessage('')
    try {
      const [a, b] = await Promise.all([contentFor(left), contentFor(right)])
      if (!a || !b) {
        setMessage('Choose two versions to compare')
        return
      }
      setDiffs(diffTemplateContent(a, b))
      const slug = getDoc().slug
      const render = async (key: string, content: Record<string, unknown>) => {
        const doc = key === DRAFT ? getDoc() : versionPreviewDoc(slug, content)
        const res = await fetch(`${base}/${collectionSlug}/preview`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ channel: 'email', doc, sample: { kind: 'event' } }),
        })
        const data = (await res.json()) as { rendered?: { html?: string } }
        return res.ok ? data.rendered?.html : undefined
      }
      const hasEmail = (content: Record<string, unknown>) =>
        Array.isArray(content.channels) && content.channels.includes('email')
      if (hasEmail(a) || hasEmail(b)) {
        const [leftHtml, rightHtml] = await Promise.all([render(left, a), render(right, b)])
        setFrames({ left: leftHtml, right: rightHtml })
      } else setFrames(null)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Compare failed')
    } finally {
      setBusy(false)
    }
  }

  const post = async (path: string, body: Record<string, unknown>, done: string) => {
    setBusy(true)
    setMessage('')
    try {
      const res = await fetch(`${base}/${collectionSlug}/${id}/${path}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = (await res.json()) as {
        error?: string
        details?: string[]
        warnings?: string[]
        version?: number
      }
      if (!res.ok) {
        setMessage([data.error || `Failed (${res.status})`, ...(data.details ?? [])].join(' — '))
        return
      }
      setMessage(
        `${done} version ${data.version}${data.warnings?.length ? ` — ${data.warnings.join('; ')}` : ''}`,
      )
      onChanged()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Request failed')
    } finally {
      setBusy(false)
    }
  }

  const options = useMemo(
    () => [DRAFT, ...versions.map((entry) => String(entry.version))],
    [versions],
  )

  if (id === undefined) {
    return (
      <div className="pn-properties">
        <div className="pn-panel-title">Versions</div>
        <p className="pn-hint">Save the template to publish it and see its versions.</p>
      </div>
    )
  }

  const publishable = status !== 'active' || hasUnpublishedChanges
  return (
    <div className="pn-properties">
      <div className="pn-panel-title">Versions</div>
      <div className="pn-toolbar">
        <span>
          {status === 'active'
            ? `Published version ${version ?? '?'}`
            : `Status: ${status ?? 'draft'}`}
          {hasUnpublishedChanges ? ' · unpublished changes' : ''}
        </span>
        <button
          type="button"
          disabled={busy || modified || !publishable}
          title={modified ? 'Save your changes first' : undefined}
          onClick={() => {
            if (confirm('Publish the saved template? New sends will use it.')) {
              void post('publish', {}, 'Published')
            }
          }}
        >
          Publish
        </button>
        {modified ? <span className="pn-hint">Save your changes before publishing.</span> : null}
      </div>

      {versions.length ? (
        <table className="pn-versions">
          <thead>
            <tr>
              <th>Version</th>
              <th>Locale</th>
              <th>Published</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {versions.map((entry) => (
              <tr key={entry.id}>
                <td>
                  v{entry.version}
                  {entry.version === version && status === 'active' ? ' (live)' : ''}
                </td>
                <td>{entry.locale || '—'}</td>
                <td>{entry.publishedAt ? new Date(entry.publishedAt).toLocaleString() : '—'}</td>
                <td>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      if (
                        confirm(
                          `Roll back to version ${entry.version}? It is published as a new version.`,
                        )
                      ) {
                        void post('rollback', { version: entry.version }, 'Rolled back as')
                      }
                    }}
                  >
                    Roll back
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="pn-hint">No published versions yet.</p>
      )}

      <div className="pn-row">
        <label className="pn-field">
          <span className="pn-label">Compare</span>
          <select value={left} onChange={(event) => setLeft(event.target.value)}>
            <option value="">Choose…</option>
            {options.map((key) => (
              <option key={key} value={key}>
                {label(key)}
              </option>
            ))}
          </select>
        </label>
        <label className="pn-field">
          <span className="pn-label">with</span>
          <select value={right} onChange={(event) => setRight(event.target.value)}>
            {options.map((key) => (
              <option key={key} value={key}>
                {label(key)}
              </option>
            ))}
          </select>
        </label>
        <button type="button" disabled={busy || !left} onClick={() => void compare()}>
          Compare
        </button>
      </div>
      {message ? (
        <p className="pn-hint" role="status">
          {message}
        </p>
      ) : null}
      {frames ? (
        <div className="pn-compare-frames">
          {(['left', 'right'] as const).map((side) => (
            <figure key={side}>
              <figcaption className="pn-label">{label(side === 'left' ? left : right)}</figcaption>
              {frames[side] ? (
                <iframe
                  title={`${label(side === 'left' ? left : right)} preview`}
                  sandbox=""
                  className="pn-preview-frame"
                  srcDoc={previewSrcDoc(frames[side] ?? '')}
                />
              ) : (
                <p className="pn-hint">No email preview</p>
              )}
            </figure>
          ))}
        </div>
      ) : null}
      {diffs ? <DiffView diffs={diffs} /> : null}
    </div>
  )
}
