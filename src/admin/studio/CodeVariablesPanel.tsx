'use client'

import React, { useMemo, useState } from 'react'
import { extractTemplatePaths } from '../../templates/variables'
import { isProvided, type VariableRoots } from '../../studio/variables'

/** Paths used in template sources that the roots do not provide. */
export const unknownTemplatePaths = (
  sources: Array<string | undefined | null>,
  roots: VariableRoots,
): string[] => {
  const paths = new Set<string>()
  for (const source of sources) {
    if (!source) continue
    try {
      for (const path of extractTemplatePaths(source, Object.keys(roots))) {
        if (!isProvided(path, roots)) paths.add(path)
      }
    } catch {
      // Syntax errors are reported by the template validation on save.
    }
  }
  return [...paths].sort()
}

/** Code mode helper: variables to copy, and unknown variables used in the code. */
export const CodeVariablesPanel: React.FC<{
  paths: string[]
  roots?: VariableRoots
  sources: Array<string | undefined | null>
}> = ({ paths, roots, sources }) => {
  const [copied, setCopied] = useState('')
  const unknown = useMemo(
    () => (roots ? unknownTemplatePaths(sources, roots) : []),
    [roots, sources],
  )
  const copy = (path: string) => {
    const text = `{{ ${path} }}`
    void navigator.clipboard?.writeText(text).then(() => setCopied(path))
  }
  return (
    <div className="pn-properties">
      <div className="pn-panel-title">Variables</div>
      <p className="pn-hint">
        Type <code>{'{{'}</code> in the HTML or text editor for suggestions, or click to copy.
      </p>
      {unknown.length ? (
        <ul className="pn-problems" aria-label="Unknown variables">
          {unknown.map((path) => (
            <li key={path}>&quot;{path}&quot; is not provided by the selected event</li>
          ))}
        </ul>
      ) : null}
      <div className="pn-row">
        {paths.map((path) => (
          <button
            key={path}
            type="button"
            className="pn-mono"
            onClick={() => copy(path)}
            title="Copy"
          >
            {copied === path ? 'Copied' : path}
          </button>
        ))}
      </div>
    </div>
  )
}
