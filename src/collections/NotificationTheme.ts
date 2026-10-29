import type { Access, Field, GlobalConfig } from 'payload'
import type { NormalizedNotificationsPluginOptions } from '../types'

const colorField = (name: string, label: string, placeholder: string): Field => ({
  name,
  type: 'text',
  label,
  admin: { placeholder, width: '25%' },
  validate: (value: unknown) =>
    !value || (typeof value === 'string' && /^#[0-9a-f]{3,8}$/i.test(value.trim()))
      ? true
      : 'Use a hex colour such as #2563eb',
})

/**
 * Brand theme for visual email designs (logo, colours, fonts, button style,
 * footer). Templates inherit it; a design's own settings override it. Changes
 * apply to a template the next time it is saved or published.
 */
export const NotificationThemeGlobal = ({
  slug = 'notification-theme',
  getOptions,
}: {
  slug?: string
  getOptions?: () => NormalizedNotificationsPluginOptions
} = {}): GlobalConfig => {
  const read: Access = ({ req }) => Boolean(req.user)
  const mediaCollection = (() => {
    try {
      return getOptions?.().templates.mediaCollection
    } catch {
      return undefined
    }
  })()
  const update: Access = async ({ req }) =>
    getOptions ? Boolean(await getOptions().access.publishTemplates({ req })) : Boolean(req.user)
  return {
    slug,
    label: 'Notification Theme',
    admin: {
      group: 'Notifications',
      description: 'Brand settings used by visual email templates.',
    },
    access: { read, update },
    fields: [
      {
        type: 'row',
        fields: [
          ...(mediaCollection
            ? [
                {
                  name: 'logo',
                  type: 'upload',
                  relationTo: mediaCollection,
                  admin: { width: '50%' },
                } as Field,
              ]
            : []),
          {
            name: 'logoUrl',
            type: 'text',
            admin: {
              width: '50%',
              description: mediaCollection
                ? 'Absolute logo URL, used when no logo is uploaded'
                : 'Absolute URL of the logo',
            },
          },
          { name: 'logoAlt', type: 'text', defaultValue: 'Logo', admin: { width: '25%' } },
          {
            name: 'logoWidth',
            type: 'number',
            defaultValue: 120,
            min: 16,
            max: 600,
            admin: { width: '25%' },
          },
        ],
      },
      {
        name: 'colors',
        type: 'group',
        fields: [
          {
            type: 'row',
            fields: [
              colorField('primary', 'Primary (buttons)', '#2563eb'),
              colorField('buttonText', 'Button text', '#ffffff'),
              colorField('text', 'Text', '#18181b'),
              colorField('muted', 'Muted text', '#71717a'),
            ],
          },
          {
            type: 'row',
            fields: [
              colorField('link', 'Links', '#2563eb'),
              colorField('background', 'Page background', '#f4f4f5'),
              colorField('contentBackground', 'Content background', '#ffffff'),
              colorField('border', 'Borders', '#e4e4e7'),
            ],
          },
        ],
      },
      {
        type: 'row',
        fields: [
          {
            name: 'fontFamily',
            type: 'text',
            admin: {
              width: '50%',
              placeholder: "-apple-system, 'Segoe UI', Roboto, Arial, sans-serif",
            },
          },
          { name: 'headingFontFamily', type: 'text', admin: { width: '50%' } },
        ],
      },
      { name: 'buttonRadius', type: 'number', defaultValue: 6, min: 0, max: 50 },
      {
        name: 'footerText',
        type: 'textarea',
        admin: {
          description:
            'Used by footer blocks without their own text. Supports **bold**, _italic_, [links](https://…) and {{ variables }}.',
        },
      },
    ],
  }
}
