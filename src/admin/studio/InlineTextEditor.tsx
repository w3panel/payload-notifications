'use client'

import React, { useRef } from 'react'

type InlineTextEditorProps = {
  value: string
  onChange: (value: string) => void
  multiline?: boolean
  label?: string
  /** Variable paths offered by the "Variable" menu. */
  variables?: string[]
  autoFocus?: boolean
}

/** Wraps the selection in `before` / `after` (or inserts `placeholder` when nothing is selected). */
export const wrapSelection = (
  value: string,
  start: number,
  end: number,
  before: string,
  after: string,
  placeholder = '',
): { value: string; start: number; end: number } => {
  const selected = value.slice(start, end) || placeholder
  const next = value.slice(0, start) + before + selected + after + value.slice(end)
  return { value: next, start: start + before.length, end: start + before.length + selected.length }
}

/**
 * Text editing for designer blocks: bold, italic, link and variable insertion
 * write the inline markup (`**b**`, `_i_`, `[label](url)`, `{{ path }}`).
 */
export const InlineTextEditor: React.FC<InlineTextEditorProps> = ({
  value,
  onChange,
  multiline = true,
  label,
  variables = [],
  autoFocus,
}) => {
  const ref = useRef<HTMLTextAreaElement | null>(null)

  const apply = (before: string, after: string, placeholder?: string) => {
    const input = ref.current
    const start = input?.selectionStart ?? value.length
    const end = input?.selectionEnd ?? value.length
    const next = wrapSelection(value, start, end, before, after, placeholder)
    onChange(next.value)
    requestAnimationFrame(() => {
      input?.focus()
      input?.setSelectionRange(next.start, next.end)
    })
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const mod = event.metaKey || event.ctrlKey
    if (mod && event.key.toLowerCase() === 'b') {
      event.preventDefault()
      apply('**', '**', 'bold')
    } else if (mod && event.key.toLowerCase() === 'i') {
      event.preventDefault()
      apply('_', '_', 'italic')
    } else if (mod && event.key.toLowerCase() === 'k') {
      event.preventDefault()
      apply('[', '](https://)', 'link')
    } else if (!multiline && event.key === 'Enter') {
      event.preventDefault()
    }
  }

  return (
    <div className="pn-inline-editor">
      {label ? <span className="pn-label">{label}</span> : null}
      <div className="pn-inline-toolbar" role="toolbar" aria-label="Text formatting">
        <button type="button" title="Bold (Ctrl/Cmd+B)" onClick={() => apply('**', '**', 'bold')}>
          <strong>B</strong>
        </button>
        <button type="button" title="Italic (Ctrl/Cmd+I)" onClick={() => apply('_', '_', 'italic')}>
          <em>I</em>
        </button>
        <button
          type="button"
          title="Link (Ctrl/Cmd+K)"
          onClick={() => apply('[', '](https://)', 'link')}
        >
          Link
        </button>
        {variables.length ? (
          <select
            aria-label="Insert variable"
            value=""
            onChange={(event) => {
              if (event.target.value) apply(`{{ ${event.target.value} }}`, '')
            }}
          >
            <option value="">Insert variable…</option>
            {variables.map((path) => (
              <option key={path} value={path}>
                {path}
              </option>
            ))}
          </select>
        ) : null}
      </div>
      <textarea
        ref={ref}
        value={value}
        rows={multiline ? 4 : 1}
        autoFocus={autoFocus}
        onKeyDown={onKeyDown}
        onChange={(event) =>
          onChange(multiline ? event.target.value : event.target.value.replace(/\n/g, ' '))
        }
      />
    </div>
  )
}
