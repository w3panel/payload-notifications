import type { Endpoint, PayloadRequest } from 'payload'
import type { NormalizedNotificationsPluginOptions } from '../types'
import { denyUnless } from '../admin-ops/access'
import { compileDesign } from '../studio/compile'
import { parseDesign } from '../studio/model'
import { loadDesignResources } from '../studio/resources'
import { imageProblems } from '../studio/save'

/**
 * `POST /api/notification-templates/compile-design { design, locale? }` —
 * compiles a visual design (with the theme, partials and media) into the HTML
 * and text the template engine renders. Used when converting a template to code.
 */
export const compileDesignEndpoint = (
  getOptions: () => NormalizedNotificationsPluginOptions,
): Endpoint => ({
  path: '/compile-design',
  method: 'post',
  handler: async (req: PayloadRequest) => {
    const denied = await denyUnless(req, getOptions().access.manageTemplates)
    if (denied) return denied
    let body: Record<string, unknown>
    try {
      body = ((await req.json?.()) ?? {}) as Record<string, unknown>
    } catch {
      return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
    }
    const parsed = parseDesign(body.design)
    if (!parsed.ok) {
      return Response.json(
        { error: 'The email design is invalid', errors: parsed.errors },
        { status: 400 },
      )
    }
    const options = getOptions()
    const resources = await loadDesignResources({ design: parsed.design, req, options })
    const errors = imageProblems(parsed.design, resources)
    if (errors.length) {
      return Response.json({ error: 'Fix the images first', errors }, { status: 400 })
    }
    const locale = typeof body.locale === 'string' && body.locale ? body.locale : undefined
    const compiled = compileDesign(parsed.design, {
      ...resources,
      ...(locale ? { lang: locale } : {}),
    })
    return Response.json({
      ok: true,
      html: compiled.html,
      text: compiled.text,
      warnings: compiled.warnings,
    })
  },
})
