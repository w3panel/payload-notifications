'use client'

import { useEffect, useState } from 'react'
import type { MediaOption, PartialOption } from './BlockProperties'

type Doc = Record<string, unknown> & { id: string | number }

const fetchDocs = async (url: string, signal: AbortSignal): Promise<Doc[]> => {
  const res = await fetch(url, { credentials: 'include', signal })
  if (!res.ok) return []
  const data = (await res.json()) as { docs?: Doc[] }
  return data.docs ?? []
}

/** Partials (and media, when a media collection is configured) for the designer's pickers. */
export const useDesignerLists = ({
  apiRoute,
  partialsSlug,
  mediaSlug,
}: {
  apiRoute: string
  partialsSlug?: string
  mediaSlug?: string
}): { partials: PartialOption[]; media: MediaOption[] } => {
  const [lists, setLists] = useState<{ partials: PartialOption[]; media: MediaOption[] }>({
    partials: [],
    media: [],
  })

  useEffect(() => {
    const controller = new AbortController()
    const base = apiRoute.replace(/\/$/, '')
    const load = async () => {
      const [partials, media] = await Promise.all([
        partialsSlug
          ? fetchDocs(`${base}/${partialsSlug}?limit=200&depth=0&sort=name`, controller.signal)
          : [],
        mediaSlug
          ? fetchDocs(`${base}/${mediaSlug}?limit=100&depth=0&sort=-updatedAt`, controller.signal)
          : [],
      ])
      setLists({
        partials: partials.map((doc) => ({
          id: doc.id,
          label: `${String(doc.name ?? doc.id)}${doc.kind ? ` (${String(doc.kind)})` : ''}`,
          version: typeof doc.version === 'number' ? doc.version : undefined,
        })),
        media: media.map((doc) => ({
          id: doc.id,
          label: String(doc.alt || doc.filename || doc.id),
          url: typeof doc.url === 'string' ? doc.url : undefined,
        })),
      })
    }
    load().catch(() => undefined)
    return () => controller.abort()
  }, [apiRoute, partialsSlug, mediaSlug])

  return lists
}
