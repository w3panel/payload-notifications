'use client'

import React from 'react'
import type { EditorAction } from '../../studio/editorState'
import {
  SOCIAL_NETWORKS,
  type Align,
  type EmailBlock,
  type EmailDesignSettings,
  type SocialNetwork,
} from '../../studio/model'
import { BLOCK_LABELS } from './BlockCanvas'
import { InlineTextEditor } from './InlineTextEditor'

export type MediaOption = { id: string | number; label: string; url?: string }
export type PartialOption = { id: string | number; label: string; version?: number }

type PropertiesProps = {
  block: EmailBlock
  dispatch: (action: EditorAction) => void
  variables?: string[]
  canRawHtml?: boolean
  media?: MediaOption[]
  partials?: PartialOption[]
  problems?: string[]
}

const Text: React.FC<{
  label: string
  value?: string | number
  onChange: (value: string) => void
  placeholder?: string
  type?: string
  disabled?: boolean
}> = ({ label, value, onChange, placeholder, type = 'text', disabled }) => (
  <label className="pn-field">
    <span className="pn-label">{label}</span>
    <input
      type={type}
      value={value ?? ''}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    />
  </label>
)

const NumberField: React.FC<{
  label: string
  value?: number
  onChange: (value: number | undefined) => void
  min?: number
  max?: number
}> = ({ label, value, onChange, min, max }) => (
  <label className="pn-field">
    <span className="pn-label">{label}</span>
    <input
      type="number"
      value={value ?? ''}
      min={min}
      max={max}
      onChange={(event) =>
        onChange(event.target.value === '' ? undefined : Number(event.target.value))
      }
    />
  </label>
)

const Select: React.FC<{
  label: string
  value?: string
  options: Array<{ value: string; label: string }>
  onChange: (value: string) => void
}> = ({ label, value, options, onChange }) => (
  <label className="pn-field">
    <span className="pn-label">{label}</span>
    <select value={value ?? ''} onChange={(event) => onChange(event.target.value)}>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  </label>
)

const Checkbox: React.FC<{
  label: string
  checked?: boolean
  onChange: (value: boolean) => void
}> = ({ label, checked, onChange }) => (
  <label className="pn-check">
    <input
      type="checkbox"
      checked={Boolean(checked)}
      onChange={(event) => onChange(event.target.checked)}
    />
    {label}
  </label>
)

const ColorField: React.FC<{
  label: string
  value?: string
  onChange: (value: string) => void
}> = ({ label, value, onChange }) => (
  <label className="pn-field">
    <span className="pn-label">{label}</span>
    <span className="pn-color">
      <input
        type="color"
        aria-label={`${label} picker`}
        value={/^#[0-9a-f]{6}$/i.test(value ?? '') ? value : '#000000'}
        onChange={(event) => onChange(event.target.value)}
      />
      <input
        value={value ?? ''}
        placeholder="theme"
        onChange={(event) => onChange(event.target.value)}
      />
    </span>
  </label>
)

const ALIGN_OPTIONS = [
  { value: '', label: 'Default' },
  { value: 'left', label: 'Left' },
  { value: 'center', label: 'Center' },
  { value: 'right', label: 'Right' },
]

const AlignField: React.FC<{ value?: Align; onChange: (value: Align | undefined) => void }> = ({
  value,
  onChange,
}) => (
  <Select
    label="Alignment"
    value={value}
    options={ALIGN_OPTIONS}
    onChange={(next) => onChange((next || undefined) as Align | undefined)}
  />
)

/** Properties form for the selected block. */
export const BlockProperties: React.FC<PropertiesProps> = ({
  block,
  dispatch,
  variables,
  canRawHtml,
  media = [],
  partials = [],
  problems = [],
}) => {
  const set = (patch: Record<string, unknown>) =>
    dispatch({ type: 'update', id: block.id, patch: patch as Partial<EmailBlock> })
  const optional = (value: string) => (value === '' ? undefined : value)

  let fields: React.ReactNode
  switch (block.type) {
    case 'section':
      fields = (
        <>
          <ColorField
            label="Background"
            value={block.background}
            onChange={(v) => set({ background: optional(v) })}
          />
          <NumberField
            label="Padding (px)"
            value={block.padding}
            min={0}
            max={200}
            onChange={(v) => set({ padding: v })}
          />
        </>
      )
      break
    case 'columns':
      fields = (
        <>
          <Select
            label="Columns"
            value={String(block.columns.length)}
            options={[1, 2, 3, 4].map((n) => ({ value: String(n), label: String(n) }))}
            onChange={(value) => {
              const count = Number(value)
              const columns = block.columns.slice(0, count)
              while (columns.length < count) columns.push({ children: [] })
              set({ columns })
            }}
          />
          {block.columns.map((column, index) => (
            <NumberField
              key={index}
              label={`Column ${index + 1} width (%)`}
              value={column.width}
              min={10}
              max={100}
              onChange={(width) =>
                set({ columns: block.columns.map((c, i) => (i === index ? { ...c, width } : c)) })
              }
            />
          ))}
          <Checkbox
            label="Stack on mobile"
            checked={block.stackOnMobile !== false}
            onChange={(stackOnMobile) => set({ stackOnMobile })}
          />
        </>
      )
      break
    case 'heading':
      fields = (
        <>
          <InlineTextEditor
            label="Text"
            value={block.text}
            multiline={false}
            variables={variables}
            onChange={(text) => set({ text })}
          />
          <Select
            label="Level"
            value={String(block.level ?? 1)}
            options={[1, 2, 3].map((n) => ({ value: String(n), label: `Heading ${n}` }))}
            onChange={(value) => set({ level: Number(value) })}
          />
          <AlignField value={block.align} onChange={(align) => set({ align })} />
          <ColorField
            label="Color"
            value={block.color}
            onChange={(v) => set({ color: optional(v) })}
          />
        </>
      )
      break
    case 'text':
      fields = (
        <>
          <InlineTextEditor
            label="Text"
            value={block.text}
            variables={variables}
            onChange={(text) => set({ text })}
          />
          <AlignField value={block.align} onChange={(align) => set({ align })} />
          <ColorField
            label="Color"
            value={block.color}
            onChange={(v) => set({ color: optional(v) })}
          />
          <NumberField
            label="Font size (px)"
            value={block.fontSize}
            min={10}
            max={72}
            onChange={(fontSize) => set({ fontSize })}
          />
        </>
      )
      break
    case 'image':
      fields = (
        <>
          {media.length ? (
            <Select
              label="Media"
              value={block.mediaId === undefined ? '' : String(block.mediaId)}
              options={[
                { value: '', label: 'Use an image URL' },
                ...media.map((m) => ({ value: String(m.id), label: m.label })),
              ]}
              onChange={(value) => {
                const chosen = media.find((m) => String(m.id) === value)
                set({
                  mediaId: chosen ? chosen.id : undefined,
                  ...(chosen?.url ? { src: chosen.url } : {}),
                })
              }}
            />
          ) : null}
          <Text
            label="Image URL"
            value={block.src}
            placeholder="https://"
            onChange={(src) => set({ src: optional(src) })}
          />
          <Text label="Alt text (required)" value={block.alt} onChange={(alt) => set({ alt })} />
          <NumberField
            label="Width (px)"
            value={block.width}
            min={1}
            max={1200}
            onChange={(width) => set({ width })}
          />
          <Text
            label="Link"
            value={block.href}
            placeholder="https:// or {{ payload.url }}"
            onChange={(href) => set({ href: optional(href) })}
          />
          <AlignField value={block.align} onChange={(align) => set({ align })} />
        </>
      )
      break
    case 'button':
      fields = (
        <>
          <InlineTextEditor
            label="Label"
            value={block.label}
            multiline={false}
            variables={variables}
            onChange={(label) => set({ label })}
          />
          <Text
            label="Link"
            value={block.href}
            placeholder="https:// or {{ payload.url }}"
            onChange={(href) => set({ href })}
          />
          <AlignField value={block.align} onChange={(align) => set({ align })} />
          <ColorField
            label="Background"
            value={block.background}
            onChange={(v) => set({ background: optional(v) })}
          />
          <ColorField
            label="Text color"
            value={block.color}
            onChange={(v) => set({ color: optional(v) })}
          />
          <NumberField
            label="Corner radius (px)"
            value={block.radius}
            min={0}
            max={50}
            onChange={(radius) => set({ radius })}
          />
        </>
      )
      break
    case 'divider':
      fields = (
        <>
          <ColorField
            label="Color"
            value={block.color}
            onChange={(v) => set({ color: optional(v) })}
          />
          <NumberField
            label="Thickness (px)"
            value={block.thickness}
            min={1}
            max={20}
            onChange={(thickness) => set({ thickness })}
          />
        </>
      )
      break
    case 'spacer':
      fields = (
        <NumberField
          label="Height (px)"
          value={block.height}
          min={0}
          max={400}
          onChange={(height) => set({ height: height ?? 0 })}
        />
      )
      break
    case 'list':
      fields = (
        <>
          <label className="pn-field">
            <span className="pn-label">Items (one per line)</span>
            <textarea
              rows={5}
              value={block.items.join('\n')}
              onChange={(event) => set({ items: event.target.value.split('\n') })}
            />
          </label>
          <Checkbox
            label="Numbered"
            checked={block.ordered}
            onChange={(ordered) => set({ ordered })}
          />
        </>
      )
      break
    case 'social':
      fields = (
        <>
          {block.links.map((link, index) => (
            <div key={index} className="pn-row">
              <Select
                label="Network"
                value={link.network}
                options={SOCIAL_NETWORKS.map((n) => ({ value: n, label: n }))}
                onChange={(network) =>
                  set({
                    links: block.links.map((l, i) =>
                      i === index ? { ...l, network: network as SocialNetwork } : l,
                    ),
                  })
                }
              />
              <Text
                label="URL"
                value={link.url}
                onChange={(url) =>
                  set({ links: block.links.map((l, i) => (i === index ? { ...l, url } : l)) })
                }
              />
              <button
                type="button"
                onClick={() => set({ links: block.links.filter((_, i) => i !== index) })}
              >
                Remove
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() =>
              set({ links: [...block.links, { network: 'website', url: 'https://' }] })
            }
          >
            Add link
          </button>
          <AlignField value={block.align} onChange={(align) => set({ align })} />
        </>
      )
      break
    case 'footer':
      fields = (
        <>
          <InlineTextEditor
            label="Text (empty = brand theme footer)"
            value={block.text}
            variables={variables}
            onChange={(text) => set({ text })}
          />
          <Checkbox
            label="Unsubscribe link"
            checked={block.includeUnsubscribe}
            onChange={(includeUnsubscribe) => set({ includeUnsubscribe })}
          />
          <AlignField value={block.align} onChange={(align) => set({ align })} />
        </>
      )
      break
    case 'loop':
      fields = (
        <>
          <Text
            label="List to repeat (variable path)"
            value={block.path}
            placeholder="payload.items"
            onChange={(path) => set({ path })}
          />
          <p className="pn-hint">
            Inside the loop, use item fields directly, e.g. {'{{ name }}'} or {'{{ this.price }}'}.
          </p>
          <Text
            label="Text when the list is empty"
            value={block.emptyText}
            onChange={(emptyText) => set({ emptyText: optional(emptyText) })}
          />
        </>
      )
      break
    case 'conditional':
      fields = (
        <Text
          label="Show when this has a value (variable path)"
          value={block.path}
          placeholder="payload.trackingNumber"
          onChange={(path) => set({ path })}
        />
      )
      break
    case 'html':
      fields = (
        <label className="pn-field">
          <span className="pn-label">HTML (sent as-is)</span>
          <textarea
            rows={8}
            value={block.html}
            disabled={!canRawHtml}
            onChange={(event) => set({ html: event.target.value })}
            className="pn-mono"
          />
          {!canRawHtml ? (
            <span className="pn-hint">You need the raw HTML permission to edit this block.</span>
          ) : null}
        </label>
      )
      break
    case 'partial':
      fields = (
        <>
          <Select
            label="Saved section"
            value={String(block.partialId ?? '')}
            options={[
              { value: '', label: 'Choose…' },
              ...partials.map((p) => ({ value: String(p.id), label: p.label })),
            ]}
            onChange={(value) => {
              const chosen = partials.find((p) => String(p.id) === value)
              set({ partialId: chosen ? chosen.id : '' })
            }}
          />
          <NumberField
            label="Pin version (empty = latest)"
            value={block.version}
            min={1}
            onChange={(version) => set({ version })}
          />
        </>
      )
      break
  }

  return (
    <div className="pn-properties">
      <div className="pn-panel-title">{BLOCK_LABELS[block.type]}</div>
      {problems.length ? (
        <ul className="pn-problems">
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      ) : null}
      {fields}
      <div className="pn-row pn-actions">
        <button
          type="button"
          onClick={() => dispatch({ type: 'nudge', id: block.id, direction: -1 })}
        >
          ↑ Up
        </button>
        <button
          type="button"
          onClick={() => dispatch({ type: 'nudge', id: block.id, direction: 1 })}
        >
          ↓ Down
        </button>
        <button type="button" onClick={() => dispatch({ type: 'duplicate', id: block.id })}>
          Duplicate
        </button>
        <button type="button" onClick={() => dispatch({ type: 'copy', id: block.id })}>
          Copy
        </button>
        <button
          type="button"
          className="pn-danger"
          onClick={() => dispatch({ type: 'remove', id: block.id })}
        >
          Delete
        </button>
      </div>
    </div>
  )
}

/** Design-wide settings (shown when no block is selected). */
export const DesignSettings: React.FC<{
  settings: EmailDesignSettings
  dispatch: (action: EditorAction) => void
}> = ({ settings, dispatch }) => {
  const set = (patch: Partial<EmailDesignSettings>) => dispatch({ type: 'settings', patch })
  const optional = (value: string) => (value === '' ? undefined : value)
  return (
    <div className="pn-properties">
      <div className="pn-panel-title">Email settings</div>
      <p className="pn-hint">Empty values use the brand theme.</p>
      <NumberField
        label="Content width (px)"
        value={settings.width}
        min={320}
        max={900}
        onChange={(width) => set({ width })}
      />
      <ColorField
        label="Page background"
        value={settings.background}
        onChange={(v) => set({ background: optional(v) })}
      />
      <ColorField
        label="Content background"
        value={settings.contentBackground}
        onChange={(v) => set({ contentBackground: optional(v) })}
      />
      <ColorField
        label="Text color"
        value={settings.textColor}
        onChange={(v) => set({ textColor: optional(v) })}
      />
      <ColorField
        label="Link color"
        value={settings.linkColor}
        onChange={(v) => set({ linkColor: optional(v) })}
      />
      <Text
        label="Font family"
        value={settings.fontFamily}
        placeholder="Arial, sans-serif"
        onChange={(v) => set({ fontFamily: optional(v) })}
      />
    </div>
  )
}
