'use client'

import React, { useRef, useState } from 'react'
import { applySuggestion, autocompleteQuery, suggestVariables } from '../../studio/variables'

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
  const [suggest, setSuggest] = useState<{ start: number; items: string[]; active: number } | null>(
    null,
  )

  /** Opens `{{` autocomplete when the caret is inside an unfinished variable. */
  const refreshSuggestions = (text: string, caret: number) => {
    const query = variables.length ? autocompleteQuery(text, caret) : null
    const items = query ? suggestVariables(variables, query.query) : []
    setSuggest(query && items.length ? { start: query.start, items, active: 0 } : null)
  }

  const accept = (path: string) => {
    const input = ref.current
    if (!suggest || !input) return
    const next = applySuggestion(value, input.selectionStart ?? value.length, suggest.start, path)
    onChange(next.value)
    setSuggest(null)
    requestAnimationFrame(() => {
      input.focus()
      input.setSelectionRange(next.caret, next.caret)
    })
  }

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
    if (suggest) {
      const count = suggest.items.length
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        event.stopPropagation()
        const step = event.key === 'ArrowDown' ? 1 : -1
        setSuggest({ ...suggest, active: (suggest.active + step + count) % count })
        return
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault()
        event.stopPropagation()
        accept(suggest.items[suggest.active])
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        setSuggest(null)
        return
      }
    }
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
      <div className="pn-autocomplete">
        <textarea
          ref={ref}
          value={value}
          rows={multiline ? 4 : 1}
          autoFocus={autoFocus}
          onKeyDown={onKeyDown}
          aria-autocomplete="list"
          aria-expanded={Boolean(suggest)}
          onBlur={() => setSuggest(null)}
          onClick={(event) =>
            refreshSuggestions(value, event.currentTarget.selectionStart ?? value.length)
          }
          onChange={(event) => {
            const text = multiline ? event.target.value : event.target.value.replace(/\n/g, ' ')
            onChange(text)
            refreshSuggestions(text, event.target.selectionStart ?? text.length)
          }}
        />
        {suggest ? (
          <ul className="pn-suggestions" role="listbox" aria-label="Variables">
            {suggest.items.map((path, index) => (
              <li
                key={path}
                role="option"
                aria-selected={index === suggest.active}
                // Keep focus in the textarea while picking.
                onMouseDown={(event) => {
                  event.preventDefault()
                  accept(path)
                }}
              >
                {path}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  )
}
