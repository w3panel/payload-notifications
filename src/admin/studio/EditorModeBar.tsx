'use client'

import React, { useState } from 'react'
import { createBlock, DESIGN_VERSION, type EmailDesign } from '../../studio/model'

type EditorModeBarProps = {
  editor: string | undefined
  design: EmailDesign | null | undefined
  setEditor: (value: 'visual' | 'code') => void
  setDesign: (design: EmailDesign) => void
  setBodies: (bodies: { html: string; text: string }) => void
  compile: (design: EmailDesign) => Promise<{ html: string; text: string } | { error: string }>
  /** For tests: replaces window.confirm. */
  confirm?: (message: string) => boolean
}

export const CONVERT_TO_CODE_WARNING =
  'Convert this email to HTML code? The generated HTML replaces the HTML and plain-text bodies. ' +
  'Later code edits are not copied back to the visual design.'
export const BACK_TO_VISUAL_WARNING =
  'Switch back to the visual designer? Saving will replace the HTML and plain-text bodies with the design, discarding code edits.'
export const START_VISUAL_WARNING =
  'Start a visual design? Saving will replace the current HTML and plain-text bodies with the design.'

type ModeActions = Pick<
  EditorModeBarProps,
  'design' | 'setEditor' | 'setDesign' | 'setBodies' | 'compile'
> & {
  confirm: (message: string) => boolean
}

/** Visual → code: compiles the design into the HTML / text bodies (one way, after a warning). */
export const convertToCode = async ({
  design,
  setEditor,
  setBodies,
  compile,
  confirm,
}: ModeActions): Promise<string> => {
  if (!confirm(CONVERT_TO_CODE_WARNING)) return ''
  if (!design) {
    setEditor('code')
    return ''
  }
  const result = await compile(design)
  if ('error' in result) return result.error
  setBodies(result)
  setEditor('code')
  return 'Converted to HTML. Save to keep the change.'
}

/** Code → visual: reuses the stored design or starts one (after a warning). */
export const switchToVisual = ({ design, setEditor, setDesign, confirm }: ModeActions): boolean => {
  if (!confirm(design ? BACK_TO_VISUAL_WARNING : START_VISUAL_WARNING)) return false
  if (!design) {
    setDesign({
      version: DESIGN_VERSION,
      settings: {},
      blocks: [createBlock('heading'), createBlock('text')],
    })
  }
  setEditor('visual')
  return true
}

/** Switches between the visual designer and HTML code, with warnings. */
export const EditorModeBar: React.FC<EditorModeBarProps> = ({
  editor,
  design,
  setEditor,
  setDesign,
  setBodies,
  compile,
  confirm = (message) => window.confirm(message),
}) => {
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const visual = editor === 'visual'

  const actions = { design, setEditor, setDesign, setBodies, compile, confirm }

  const toCode = async () => {
    setBusy(true)
    try {
      setStatus(await convertToCode(actions))
    } finally {
      setBusy(false)
    }
  }

  const toVisual = () => {
    if (switchToVisual(actions)) setStatus('')
  }

  return (
    <div className="pn-toolbar" role="group" aria-label="Email editor">
      <span className="pn-label">Email editor</span>
      <button
        type="button"
        className={visual ? 'pn-active' : ''}
        aria-pressed={visual}
        disabled={busy || visual}
        onClick={toVisual}
      >
        Visual designer
      </button>
      <button
        type="button"
        className={!visual ? 'pn-active' : ''}
        aria-pressed={!visual}
        disabled={busy || !visual}
        onClick={() => void toCode()}
      >
        {busy ? 'Converting…' : 'HTML code'}
      </button>
      {status ? (
        <span className="pn-hint" role="status">
          {status}
        </span>
      ) : null}
    </div>
  )
}
