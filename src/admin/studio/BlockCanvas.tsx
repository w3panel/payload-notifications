'use client'

import React, { useState } from 'react'
import type { EditorAction, Slot } from '../../studio/editorState'
import { inlineToHtml } from '../../studio/inline'
import type { EmailBlock, EmailBlockType, EmailDesign } from '../../studio/model'

export const DRAG_NEW = 'application/x-pn-new-block'
export const DRAG_MOVE = 'application/x-pn-move-block'

export const BLOCK_LABELS: Record<EmailBlockType, string> = {
  section: 'Section',
  columns: 'Columns',
  heading: 'Heading',
  text: 'Text',
  image: 'Image',
  button: 'Button',
  divider: 'Divider',
  spacer: 'Spacer',
  list: 'List',
  social: 'Social links',
  footer: 'Footer',
  loop: 'Repeat (line items)',
  conditional: 'Show if',
  html: 'Raw HTML',
  partial: 'Saved section',
}

/**
 * Inline markup as preview HTML: escaped text with variables shown as chips.
 * `isKnown` marks variables the context does not provide.
 */
export const previewInline = (text: string, isKnown?: (expression: string) => boolean): string =>
  inlineToHtml(text).replace(/\{\{ ([^{}]+?) \}\}/g, (_, expression: string) => {
    const known = isKnown ? isKnown(expression) : true
    const safe = expression.replace(/[<>"&]/g, '')
    return `<span class="pn-var${known ? '' : ' pn-var-unknown'}" title="${known ? 'Variable' : 'Not provided by the selected event'}">${safe}</span>`
  })

type CanvasProps = {
  design: EmailDesign
  selectedId: string | null
  dispatch: (action: EditorAction) => void
  /** Expressions per block ID that the selected event does not provide (highlighted). */
  unknown?: Record<string, string[]>
  /** Problems per block ID (shown as a badge). */
  problems?: Record<string, string[]>
}

const DropZone: React.FC<{
  slot: Slot
  index: number
  dispatch: CanvasProps['dispatch']
  empty?: boolean
}> = ({ slot, index, dispatch, empty }) => {
  const [over, setOver] = useState(false)
  return (
    <div
      className={`pn-drop${over ? ' pn-drop-over' : ''}${empty ? ' pn-drop-empty' : ''}`}
      onDragOver={(event) => {
        event.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault()
        event.stopPropagation()
        setOver(false)
        const type = event.dataTransfer.getData(DRAG_NEW)
        const id = event.dataTransfer.getData(DRAG_MOVE)
        if (type) dispatch({ type: 'insert', block: type as EmailBlockType, slot, index })
        else if (id) dispatch({ type: 'move', id, slot, index })
      }}
    >
      {empty ? 'Drop blocks here' : null}
    </div>
  )
}

const BlockList: React.FC<CanvasProps & { blocks: EmailBlock[]; slot: Slot }> = (props) => {
  const { blocks, slot, dispatch } = props
  return (
    <div className="pn-list">
      <DropZone slot={slot} index={0} dispatch={dispatch} empty={!blocks.length} />
      {blocks.map((block, index) => (
        <React.Fragment key={block.id}>
          <BlockView {...props} block={block} />
          <DropZone slot={slot} index={index + 1} dispatch={dispatch} />
        </React.Fragment>
      ))}
    </div>
  )
}

const Inline: React.FC<{ text: string; isKnown?: (expression: string) => boolean }> = ({
  text,
  isKnown,
}) => (
  // previewInline escapes all text; variables become chips.
  <span dangerouslySetInnerHTML={{ __html: previewInline(text, isKnown) }} />
)

const BlockBody: React.FC<CanvasProps & { block: EmailBlock }> = (props) => {
  const { block } = props
  const unknown = props.unknown?.[block.id]
  const isKnown = unknown?.length
    ? (expression: string) => !unknown.includes(expression)
    : undefined
  const child = (blocks: EmailBlock[], list: number) => (
    <BlockList {...props} blocks={blocks} slot={{ parentId: block.id, list }} />
  )
  switch (block.type) {
    case 'section':
      return (
        <div
          style={{
            background: block.background || undefined,
            padding: Math.min(block.padding ?? 24, 48) / 2,
          }}
        >
          {child(block.children, 0)}
        </div>
      )
    case 'columns':
      return (
        <div className="pn-columns">
          {block.columns.map((column, index) => (
            <div
              key={index}
              className="pn-column"
              style={{ flexBasis: column.width ? `${column.width}%` : undefined }}
            >
              {child(column.children, index)}
            </div>
          ))}
        </div>
      )
    case 'heading': {
      const size = block.level === 3 ? 18 : block.level === 2 ? 22 : 28
      return (
        <div
          style={{ fontSize: size, fontWeight: 700, textAlign: block.align, color: block.color }}
        >
          <Inline text={block.text} isKnown={isKnown} />
        </div>
      )
    }
    case 'text':
      return (
        <div style={{ textAlign: block.align, color: block.color, fontSize: block.fontSize }}>
          <Inline text={block.text} isKnown={isKnown} />
        </div>
      )
    case 'image':
      return (
        <div style={{ textAlign: block.align }}>
          {block.src ? (
            <img
              src={block.src}
              alt={block.alt}
              style={{ maxWidth: block.width ?? '100%', height: 'auto' }}
            />
          ) : (
            <div className="pn-placeholder">
              {block.mediaId ? `Media #${block.mediaId}` : 'Choose an image'}
            </div>
          )}
        </div>
      )
    case 'button':
      return (
        <div style={{ textAlign: block.align ?? 'center' }}>
          <span
            className="pn-button-preview"
            style={{ background: block.background, color: block.color, borderRadius: block.radius }}
          >
            <Inline text={block.label} isKnown={isKnown} />
          </span>
        </div>
      )
    case 'divider':
      return <hr style={{ borderColor: block.color, borderTopWidth: block.thickness ?? 1 }} />
    case 'spacer':
      return <div className="pn-spacer" style={{ height: Math.min(block.height, 120) }} />
    case 'list': {
      const Tag = block.ordered ? 'ol' : 'ul'
      return (
        <Tag style={{ margin: 0 }}>
          {block.items.map((item, index) => (
            <li key={index}>
              <Inline text={item} isKnown={isKnown} />
            </li>
          ))}
        </Tag>
      )
    }
    case 'social':
      return (
        <div style={{ textAlign: block.align ?? 'center' }}>
          {block.links.map((link) => link.network).join(' · ') || 'Add links'}
        </div>
      )
    case 'footer':
      return (
        <div className="pn-footer-preview" style={{ textAlign: block.align ?? 'center' }}>
          <Inline text={block.text || 'Footer text from the brand theme'} isKnown={isKnown} />
          {block.includeUnsubscribe ? <div>Unsubscribe</div> : null}
        </div>
      )
    case 'loop':
      return (
        <div className="pn-logic">
          <div className="pn-logic-label">
            Repeat for each <code>{block.path}</code>
          </div>
          {child(block.children, 0)}
        </div>
      )
    case 'conditional':
      return (
        <div className="pn-logic">
          <div className="pn-logic-label">
            Show if <code>{block.path}</code>
          </div>
          {child(block.children, 0)}
          <div className="pn-logic-label">Otherwise</div>
          {child(block.elseChildren ?? [], 1)}
        </div>
      )
    case 'html':
      return <pre className="pn-code-preview">{block.html || 'Raw HTML'}</pre>
    case 'partial':
      return (
        <div className="pn-placeholder">
          Saved section {block.partialId ? `#${block.partialId}` : '(choose one)'}
          {block.version ? ` v${block.version}` : ''}
        </div>
      )
  }
}

const BlockView: React.FC<CanvasProps & { block: EmailBlock }> = (props) => {
  const { block, selectedId, dispatch, problems } = props
  const selected = block.id === selectedId
  const issues = problems?.[block.id] ?? []
  return (
    <div
      className={`pn-block${selected ? ' pn-block-selected' : ''}${issues.length ? ' pn-block-problem' : ''}`}
      draggable
      tabIndex={0}
      role="button"
      aria-pressed={selected}
      aria-label={`${BLOCK_LABELS[block.type]} block`}
      onDragStart={(event) => {
        event.stopPropagation()
        event.dataTransfer.setData(DRAG_MOVE, block.id)
        event.dataTransfer.effectAllowed = 'move'
      }}
      onClick={(event) => {
        event.stopPropagation()
        dispatch({ type: 'select', id: block.id })
      }}
      onFocus={(event) => {
        if (event.target === event.currentTarget) dispatch({ type: 'select', id: block.id })
      }}
    >
      <span className="pn-block-tag">
        {BLOCK_LABELS[block.type]}
        {issues.length ? ` · ${issues.length} issue${issues.length > 1 ? 's' : ''}` : ''}
      </span>
      <BlockBody {...props} block={block} />
    </div>
  )
}

/** The design canvas: blocks with drop zones between them. */
export const BlockCanvas: React.FC<CanvasProps> = (props) => {
  const { design } = props
  const settings = design.settings ?? {}
  return (
    <div className="pn-canvas" style={{ background: settings.background || '#f4f4f5' }}>
      <div
        className="pn-canvas-body"
        style={{
          maxWidth: settings.width || 600,
          background: settings.contentBackground || '#ffffff',
          fontFamily: settings.fontFamily,
          color: settings.textColor || '#18181b',
        }}
        onClick={() => props.dispatch({ type: 'select', id: null })}
      >
        <BlockList {...props} blocks={design.blocks} slot={{ parentId: null, list: 0 }} />
      </div>
    </div>
  )
}
