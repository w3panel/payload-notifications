'use client'

import { useEffect, useState } from 'react'
import type { VariableRoots } from '../../studio/variables'

export type TemplateVariables = { paths: string[]; roots?: VariableRoots; error?: string }

/** Loads the variables an event or trigger provides (`GET …/variables`). */
export const useTemplateVariables = ({
  apiRoute,
  collectionSlug,
  event,
  trigger,
}: {
  apiRoute: string
  collectionSlug: string
  event?: string
  trigger?: string
}): TemplateVariables => {
  const [state, setState] = useState<TemplateVariables>({ paths: [] })

  useEffect(() => {
    const controller = new AbortController()
    const params = new URLSearchParams()
    if (event) params.set('event', event)
    if (trigger) params.set('trigger', trigger)
    const url = `${apiRoute.replace(/\/$/, '')}/${collectionSlug}/variables?${params}`
    // Wait for typing to settle before asking the server.
    const timer = setTimeout(() => {
      fetch(url, { credentials: 'include', signal: controller.signal })
        .then(async (res) => {
          const data = (await res.json()) as {
            variables?: string[]
            roots?: VariableRoots
            error?: string
          }
          if (!res.ok) throw new Error(data.error || `Variables request failed (${res.status})`)
          setState({ paths: data.variables ?? [], roots: data.roots })
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return
          setState({ paths: [], error: error instanceof Error ? error.message : String(error) })
        })
    }, 300)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [apiRoute, collectionSlug, event, trigger])

  return state
}
