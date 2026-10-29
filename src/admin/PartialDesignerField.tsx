'use client'

import React from 'react'
import { useField } from '@payloadcms/ui'
import type { EmailDesign } from '../studio/model'
import { STUDIO_CSS } from './studio/styles'
import { useDesignerLists } from './studio/useDesignerLists'
import { VisualEmailEditor } from './studio/VisualEmailEditor'

type PartialDesignerFieldProps = {
  field?: { admin?: { custom?: { apiRoute?: string; partialsSlug?: string; mediaSlug?: string } } }
}

/** Payload admin UI field: the visual designer for a template partial (`design`). */
export const PartialDesignerField: React.FC<PartialDesignerFieldProps> = (props) => {
  const custom = props.field?.admin?.custom
  const design = useField<EmailDesign | null>({ path: 'design' })
  const lists = useDesignerLists({
    apiRoute: custom?.apiRoute || '/api',
    partialsSlug: custom?.partialsSlug,
    mediaSlug: custom?.mediaSlug,
  })
  return (
    <div className="pn-studio">
      <style>{STUDIO_CSS}</style>
      <div style={{ fontWeight: 600 }}>Partial design</div>
      <VisualEmailEditor
        design={design.value}
        onChange={(next) => design.setValue(next)}
        partials={lists.partials}
        media={lists.media}
      />
    </div>
  )
}

export default PartialDesignerField
