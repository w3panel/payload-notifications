'use client'

import { useEffect } from 'react'
import { autocompleteQuery, suggestVariables } from '../../studio/variables'

type Disposable = { dispose: () => void }
type Position = { lineNumber: number; column: number }
type Model = { getLineContent: (line: number) => string }

/** The parts of the Monaco API used here. */
export type MonacoLike = {
  languages: {
    CompletionItemKind: { Variable: number }
    registerCompletionItemProvider: (
      language: string,
      provider: {
        triggerCharacters?: string[]
        provideCompletionItems: (model: Model, position: Position) => { suggestions: unknown[] }
      },
    ) => Disposable
  }
}

/** Monaco completion items for `{{` variables at a position. */
export const variableCompletions = (
  monaco: MonacoLike,
  model: Model,
  position: Position,
  paths: string[],
): { suggestions: unknown[] } => {
  const line = model.getLineContent(position.lineNumber)
  const before = line.slice(0, position.column - 1)
  const query = autocompleteQuery(before, before.length)
  if (!query) return { suggestions: [] }
  // Replace an existing closing `}}` right after the caret too.
  const closing = /^\s*\}\}/.exec(line.slice(position.column - 1))?.[0].length ?? 0
  const range = {
    startLineNumber: position.lineNumber,
    endLineNumber: position.lineNumber,
    startColumn: query.start + 1,
    endColumn: position.column + closing,
  }
  return {
    suggestions: suggestVariables(paths, query.query, 50).map((path) => ({
      label: path,
      kind: monaco.languages.CompletionItemKind.Variable,
      insertText: `{{ ${path} }}`,
      filterText: `{{${query.query}`,
      range,
    })),
  }
}

/** Registers `{{` variable completion for Monaco's HTML and plain-text editors. */
export const registerVariableCompletion = (
  monaco: MonacoLike,
  getPaths: () => string[],
  languages = ['html', 'plaintext'],
): Disposable => {
  const registrations = languages.map((language) =>
    monaco.languages.registerCompletionItemProvider(language, {
      triggerCharacters: ['{'],
      provideCompletionItems: (model, position) =>
        variableCompletions(monaco, model, position, getPaths()),
    }),
  )
  return { dispose: () => registrations.forEach((registration) => registration.dispose()) }
}

/**
 * Adds variable completion to Payload's code fields while `enabled`. Payload
 * loads Monaco on demand, so this waits for `window.monaco` (up to 30 s).
 */
export const useMonacoVariableCompletion = (paths: string[], enabled: boolean) => {
  useEffect(() => {
    if (!enabled || !paths.length || typeof window === 'undefined') return
    let registration: Disposable | undefined
    let tries = 0
    const attach = () => {
      const monaco = (window as unknown as { monaco?: MonacoLike }).monaco
      if (monaco?.languages?.registerCompletionItemProvider) {
        registration = registerVariableCompletion(monaco, () => paths)
        return true
      }
      return false
    }
    if (attach()) return () => registration?.dispose()
    const timer = setInterval(() => {
      tries += 1
      if (attach() || tries > 60) clearInterval(timer)
    }, 500)
    return () => {
      clearInterval(timer)
      registration?.dispose()
    }
  }, [paths, enabled])
}
