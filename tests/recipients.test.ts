import { describe, expect, it, mock } from 'bun:test'
import { normalizePluginOptions } from '../src/config/normalizePluginOptions'
import {
  maskDestination,
  normalizeEmail,
  normalizePhone,
  resolveRecipients,
  validateRecipientDefinitions,
} from '../src/recipients'
import type { NotificationDataContext, NotificationEvent } from '../src/types'

type Doc = Record<string, unknown>

const users: Doc[] = [
  {
    id: 'user_1',
    name: 'Alex',
    email: 'Alex@Example.com ',
    phone: '098765 43210',
    roles: ['customer'],
  },
  {
    id: 'mgr_1',
    name: 'Priya',
    email: 'priya@example.com',
    phone: '+91 99999 00000',
    roles: ['admin'],
  },
  { id: 'admin_2', name: 'Sam', email: 'ops@example.com', roles: ['admin'] },
]

const createPayload = () => {
  const find = mock(
    async ({
      where,
      limit,
    }: {
      where: Record<string, Record<string, unknown[]>>
      limit: number
    }) => {
      if (where.id) {
        const ids = where.id.in.map(String)
        return { docs: users.filter((user) => ids.includes(String(user.id))) }
      }
      const [field, condition] = Object.entries(where)[0]
      const role = condition.in[0]
      return {
        docs: users
          .filter((user) => (user[field] as string[] | undefined)?.includes(role as string))
          .slice(0, limit),
      }
    },
  )
  return { payload: { find, logger: { warn: mock(() => undefined) } } as never, find }
}

const event: NotificationEvent = {
  name: 'order.paid',
  userId: 'user_1',
  payload: { orderId: 'o1' },
}
const context = {
  event: 'order.paid',
  userId: 'user_1',
  payload: {},
  trigger: { name: 'order.paid' },
  customer: { id: 'user_1' },
  order: { accountManager: { id: 'mgr_1', name: 'populated' }, watchers: ['user_1', 'ghost'] },
} as NotificationDataContext

const options = normalizePluginOptions({
  recipients: { defaultCountryCode: '+91' },
  recipientResolvers: {
    supportTeam: () => ['mgr_1', { email: 'support@example.com', name: 'Support' }],
    broken: () => {
      throw new Error('crm down')
    },
  },
  recipientQueries: { admins: { where: { roles: { in: ['admin'] } }, maxResults: 10 } },
})

describe('destination helpers', () => {
  it('normalizes phones to E.164', () => {
    expect(normalizePhone('+91 98765-43210')).toBe('+919876543210')
    expect(normalizePhone('0091 9876543210')).toBe('+919876543210')
    expect(normalizePhone('09876543210', '+91')).toBe('+919876543210')
    expect(normalizePhone('9876543210')).toBeUndefined()
    expect(normalizePhone('+12')).toBeUndefined()
  })

  it('normalizes emails and masks destinations', () => {
    expect(normalizeEmail(' A@B.co ')).toBe('a@b.co')
    expect(normalizeEmail('nope')).toBeUndefined()
    expect(maskDestination('alex@example.com')).toBe('a***@example.com')
    expect(maskDestination('+919876543210')).toBe('+91******3210')
  })
})

describe('resolveRecipients', () => {
  it('resolves customer, account manager and a static ops email as three recipients', async () => {
    const { payload, find } = createPayload()
    const { recipients, warnings } = await resolveRecipients({
      payload,
      event,
      context,
      options,
      definitions: [
        { type: 'context', path: 'customer.id', alias: 'customer' },
        { type: 'relationship', path: 'order.accountManager', alias: 'manager' },
        { type: 'static', email: 'Ops-Team@example.com', alias: 'ops' },
      ],
    })

    expect(warnings).toEqual([])
    expect(recipients).toEqual([
      {
        key: 'user:user_1',
        aliases: ['customer'],
        recipientId: 'user_1',
        name: 'Alex',
        locale: undefined,
        timezone: undefined,
        destinations: {
          email: 'alex@example.com',
          sms: '+919876543210',
          whatsapp: '+919876543210',
          inapp: 'user_1',
        },
      },
      {
        key: 'user:mgr_1',
        aliases: ['manager'],
        recipientId: 'mgr_1',
        name: 'Priya',
        locale: undefined,
        timezone: undefined,
        destinations: {
          email: 'priya@example.com',
          sms: '+919999900000',
          whatsapp: '+919999900000',
          inapp: 'mgr_1',
        },
      },
      {
        key: 'email:ops-team@example.com',
        aliases: ['ops'],
        recipientId: undefined,
        name: undefined,
        locale: undefined,
        timezone: undefined,
        destinations: { email: 'ops-team@example.com', sms: undefined, whatsapp: undefined },
      },
    ])
    // One batched user load with destination fields only
    expect(find).toHaveBeenCalledTimes(1)
    const call = find.mock.calls[0][0] as unknown as { select: Doc; overrideAccess: boolean }
    expect(call.overrideAccess).toBe(true)
    expect(call.select).toMatchObject({ email: true, phone: true, name: true })
  })

  it('defaults to the event user and merges duplicates across aliases', async () => {
    const { payload } = createPayload()
    const defaults = await resolveRecipients({ payload, event, context, options })
    expect(defaults.recipients.map((r) => [r.key, r.aliases])).toEqual([['user:user_1', ['user']]])

    const merged = await resolveRecipients({
      payload,
      event,
      context,
      options,
      definitions: [
        { type: 'eventUser' },
        { type: 'context', path: 'customer', alias: 'customer' },
        { type: 'static', email: 'alex@example.com', alias: 'copy' },
      ],
    })
    expect(merged.recipients).toHaveLength(1)
    expect(merged.recipients[0].aliases).toEqual(['user', 'customer', 'copy'])
  })

  it('resolves roles, named queries and resolvers', async () => {
    const { payload } = createPayload()
    const { recipients, warnings } = await resolveRecipients({
      payload,
      event,
      context,
      options,
      definitions: [
        { type: 'role', role: 'admin', alias: 'admins' },
        { type: 'query', name: 'admins', alias: 'queried' },
        { type: 'resolver', name: 'supportTeam', alias: 'support' },
        { type: 'resolver', name: 'broken', alias: 'crm' },
      ],
    })
    expect(recipients.map((r) => [r.key, r.aliases])).toEqual([
      ['user:mgr_1', ['admins', 'queried', 'support']],
      ['user:admin_2', ['admins', 'queried']],
      ['email:support@example.com', ['support']],
    ])
    expect(warnings).toEqual(['recipients: recipient resolver "broken" failed: crm down'])
  })

  it('warns about missing users, empty paths and missing event users', async () => {
    const { payload } = createPayload()
    const { recipients, warnings } = await resolveRecipients({
      payload,
      event: { name: 'order.paid' },
      context,
      options,
      owner: 'trigger "t"',
      definitions: [
        { type: 'eventUser' },
        { type: 'context', path: 'order.watchers', alias: 'watchers' },
        { type: 'context', path: 'order.nobody', alias: 'nobody' },
      ],
    })
    expect(recipients.map((r) => r.key)).toEqual(['user:user_1'])
    expect(warnings).toEqual([
      'trigger "t": recipient "user" has no event userId',
      'trigger "t": recipient "nobody" found nothing at "order.nobody"',
      'trigger "t": recipient "watchers" user "ghost" was not found',
    ])
  })

  it('caps recipients per event', async () => {
    const { payload } = createPayload()
    const capped = normalizePluginOptions({ recipients: { maxPerEvent: 1 } })
    const { recipients, warnings } = await resolveRecipients({
      payload,
      event,
      context,
      options: capped,
      definitions: [{ type: 'role', role: 'admin' }],
    })
    expect(recipients).toHaveLength(1)
    expect(warnings).toEqual([])

    const many = await resolveRecipients({
      payload,
      event,
      context,
      options: capped,
      definitions: [
        { type: 'static', email: 'a@x.co' },
        { type: 'static', email: 'b@x.co' },
      ],
    })
    expect(many.recipients).toHaveLength(1)
    expect(many.warnings[0]).toContain('exceed recipients.maxPerEvent (1)')
  })
})

describe('validateRecipientDefinitions', () => {
  it('reports invalid definitions', () => {
    expect(
      validateRecipientDefinitions(
        [
          { type: 'static', email: 'bad', phone: '123', alias: 'ops' },
          { type: 'static', alias: 'ops' },
          { type: 'context', path: '', alias: 'all' },
          { type: 'resolver', name: 'missing' },
          { type: 'query', name: 'missing' },
          { type: 'role', role: '' },
          { type: 'email' },
        ],
        options,
        'trigger "t"',
      ),
    ).toEqual([
      'trigger "t" recipient "ops": invalid email',
      'trigger "t" recipient "ops": phone must be E.164 (e.g. +919876543210)',
      'trigger "t" recipient "ops": duplicate alias',
      'trigger "t" recipient "ops": email or phone is required',
      'trigger "t" recipient "all": alias must be an identifier other than "all"',
      'trigger "t" recipient "all": path is required',
      'trigger "t" recipient "recipient3": recipient resolver "missing" is not registered',
      'trigger "t" recipient "recipient4": recipient query "missing" is not registered',
      'trigger "t" recipient "recipient5": role is required',
      'trigger "t": recipients[6] has unknown type "email"',
    ])
  })
})
