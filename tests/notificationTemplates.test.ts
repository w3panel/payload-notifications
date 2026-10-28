import { describe, expect, it } from 'bun:test'
import {
  NotificationTemplatesCollection,
  validateTemplateSlug,
} from '../src/collections/NotificationTemplates'

describe('notification-templates collection', () => {
  it('builds collection with all required fields', () => {
    const collection = NotificationTemplatesCollection()

    expect(collection.slug).toBe('notification-templates')
    expect(collection.labels?.singular).toBe('Notification Template')
    expect(collection.labels?.plural).toBe('Notification Templates')
    expect(collection.timestamps).toBe(true)

    const fieldNames = collection.fields.map((f: any) => f.name).filter(Boolean)
    expect(fieldNames).toContain('name')
    expect(fieldNames).toContain('slug')
    expect(fieldNames).toContain('description')
    expect(fieldNames).toContain('channels')
    expect(fieldNames).toContain('category')
    expect(fieldNames).toContain('status')
    expect(fieldNames).toContain('version')
    expect(fieldNames).toContain('email')
    expect(fieldNames).toContain('sms')
    expect(fieldNames).toContain('whatsapp')
    expect(fieldNames).toContain('inapp')
    expect(fieldNames).toContain('variables')
  })

  it('supports custom slug', () => {
    const collection = NotificationTemplatesCollection({ slug: 'my-templates' })
    expect(collection.slug).toBe('my-templates')
  })

  it('supports access overrides', () => {
    const customAccess = () => true
    const collection = NotificationTemplatesCollection({
      overrides: {
        access: {
          read: customAccess,
          create: customAccess,
        },
      },
    })

    expect(collection.access?.read).toBe(customAccess)
    expect(collection.access?.create).toBe(customAccess)
  })

  it('supports admin overrides', () => {
    const collection = NotificationTemplatesCollection({
      overrides: {
        admin: {
          useAsTitle: 'slug',
        },
      },
    })

    expect(collection.admin?.useAsTitle).toBe('slug')
  })

  it('denies delete access by default', () => {
    const collection = NotificationTemplatesCollection()
    const deleteAccess = collection.access?.delete
    expect(typeof deleteAccess).toBe('function')

    if (typeof deleteAccess === 'function') {
      expect(deleteAccess({} as any)).toBe(false)
    }
  })

  it('has beforeChange hook for version auto-increment', () => {
    const collection = NotificationTemplatesCollection()
    expect(collection.hooks?.beforeChange).toBeDefined()
    expect(collection.hooks?.beforeChange?.length).toBeGreaterThan(0)
  })

  it('auto-increments version when status becomes active', () => {
    const collection = NotificationTemplatesCollection()
    const hook = collection.hooks?.beforeChange?.[0]

    if (!hook) throw new Error('No beforeChange hook found')

    // Simulate status transition from draft to active
    const result = (hook as Function)({
      data: { status: 'active', name: 'Test' },
      originalDoc: { status: 'draft', version: 2 },
    })

    expect(result.version).toBe(3)
  })

  it('does not increment version when already active', () => {
    const collection = NotificationTemplatesCollection()
    const hook = collection.hooks?.beforeChange?.[0]

    if (!hook) throw new Error('No beforeChange hook found')

    const result = (hook as Function)({
      data: { status: 'active', name: 'Updated' },
      originalDoc: { status: 'active', version: 3 },
    })

    // version should not change when it was already active
    expect(result.version).toBeUndefined()
  })

  it('does not increment version for draft status', () => {
    const collection = NotificationTemplatesCollection()
    const hook = collection.hooks?.beforeChange?.[0]

    if (!hook) throw new Error('No beforeChange hook found')

    const result = (hook as Function)({
      data: { status: 'draft', name: 'Draft' },
      originalDoc: { status: 'draft', version: 1 },
    })

    expect(result.version).toBeUndefined()
  })

  it('has correct channel content subfields for email', () => {
    const collection = NotificationTemplatesCollection()
    const emailField = collection.fields.find((f: any) => f.name === 'email') as any

    expect(emailField).toBeDefined()
    expect(emailField.type).toBe('group')

    const emailSubfields = emailField.fields.map((f: any) => f.name)
    expect(emailSubfields).toContain('subject')
    expect(emailSubfields).toContain('htmlBody')
    expect(emailSubfields).toContain('textBody')
  })

  it('has correct channel content subfields for inapp', () => {
    const collection = NotificationTemplatesCollection()
    const inappField = collection.fields.find((f: any) => f.name === 'inapp') as any

    expect(inappField).toBeDefined()
    const inappSubfields = inappField.fields.map((f: any) => f.name)
    expect(inappSubfields).toContain('title')
    expect(inappSubfields).toContain('body')
  })

  it('has variables array with correct subfields', () => {
    const collection = NotificationTemplatesCollection()
    const variablesField = collection.fields.find((f: any) => f.name === 'variables') as any

    expect(variablesField).toBeDefined()
    expect(variablesField.type).toBe('array')

    const subfields = variablesField.fields.map((f: any) => f.name)
    expect(subfields).toContain('name')
    expect(subfields).toContain('type')
    expect(subfields).toContain('required')
    expect(subfields).toContain('defaultValue')
  })
})

describe('template slug validation', () => {
  it('accepts event-style keys', () => {
    for (const slug of [
      'order.paid',
      'user:signup',
      'welcome-email',
      'order_shipped',
      'v2.order.paid',
    ]) {
      expect(validateTemplateSlug(slug)).toBe(true)
    }
  })

  it('rejects unsafe keys', () => {
    for (const slug of [
      'order paid',
      'order/paid',
      '.order',
      'order..paid',
      'order.',
      '{{order}}',
    ]) {
      expect(validateTemplateSlug(slug)).toBeString()
    }
  })

  it('is wired to the slug field', () => {
    const slugField = NotificationTemplatesCollection().fields.find(
      (f: any) => f.name === 'slug',
    ) as any
    expect(slugField.validate).toBe(validateTemplateSlug)
  })
})
