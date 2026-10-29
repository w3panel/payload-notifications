import type { Access, PayloadRequest, Where } from 'payload'
import type { NotificationAccessCheck, NormalizedNotificationsPluginOptions } from '../types'

type GetOptions = () => NormalizedNotificationsPluginOptions
type AccessName = keyof NormalizedNotificationsPluginOptions['access']

/** The signed-in user's tenant (`tenancy.userField`), or undefined for platform users. */
export const userTenant = (
  req: PayloadRequest,
  options: Pick<NormalizedNotificationsPluginOptions, 'tenancy'>,
): string | undefined => {
  if (!options.tenancy || !req.user) return undefined
  const value = (req.user as Record<string, unknown>)[options.tenancy.userField]
  if (value === null || value === undefined || value === '') return undefined
  if (typeof value === 'object') {
    const id = (value as { id?: unknown }).id
    return id === undefined || id === null ? undefined : String(id)
  }
  return String(value)
}

/**
 * Tenant filter for operational records. Users with a tenant see only their
 * tenant's records; users without one (platform admins) see everything.
 */
export const tenantWhere = (
  req: PayloadRequest,
  options: Pick<NormalizedNotificationsPluginOptions, 'tenancy'>,
  field = 'tenant',
): Where | undefined => {
  const tenant = userTenant(req, options)
  return tenant === undefined ? undefined : ({ [field]: { equals: tenant } } as Where)
}

/** Collection access: the named check, plus the tenant filter when tenancy is on. */
export const accessWithTenant =
  (getOptions: GetOptions, check: AccessName, tenantField?: string): Access =>
  async ({ req }) => {
    if (!req.user) return false
    const options = getOptions()
    if (!(await options.access[check]({ req }))) return false
    if (!tenantField) return true
    return tenantWhere(req, options, tenantField) ?? true
  }

/** True when the request passes any of the checks. */
export const allowAny = async (req: PayloadRequest, checks: NotificationAccessCheck[]) => {
  for (const check of checks) if (await check({ req })) return true
  return false
}

/** 401 / 403 response for endpoints, or undefined when allowed. */
export const denyUnless = async (
  req: PayloadRequest,
  checks: NotificationAccessCheck | NotificationAccessCheck[],
): Promise<Response | undefined> => {
  if (!req.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const list = Array.isArray(checks) ? checks : [checks]
  return (await allowAny(req, list))
    ? undefined
    : Response.json({ error: 'Forbidden' }, { status: 403 })
}
