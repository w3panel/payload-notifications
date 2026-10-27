import React from 'react'

export const TemplateEngineHelp: React.FC = () => {
  return (
    <div
      style={{
        marginTop: '0.75rem',
        padding: '0.75rem 1rem',
        border: '1px solid var(--theme-elevation-150, #ddd)',
        borderRadius: 4,
        fontSize: 13,
        lineHeight: 1.45,
      }}
    >
      <strong>Template engine cheatsheet</strong>
      <ul style={{ margin: '0.5rem 0 0', paddingLeft: '1.25rem' }}>
        <li>
          Variables: <code>{'{{ event }}'}</code>, <code>{'{{ userId }}'}</code>,{' '}
          <code>{'{{ payload.orderId }}'}</code>
        </li>
        <li>
          Conditionals: <code>{'{{#if payload.shipped}}…{{else}}…{{/if}}'}</code>
        </li>
        <li>
          Loops: <code>{'{{#each payload.items}}{{ this.name }}{{/each}}'}</code>
        </li>
        <li>
          Formatters: <code>{'{{ date payload.createdAt }}'}</code>,{' '}
          <code>{'{{ currency payload.total "USD" }}'}</code>
        </li>
        <li>
          Raw HTML insert: <code>{'{{{ payload.html }}}'}</code> (use carefully)
        </li>
        <li>
          Defaults: <code>{'{{ payload.name | default "Guest" }}'}</code>
        </li>
      </ul>
      <p style={{ margin: '0.5rem 0 0' }}>
        Full docs: <code>docs/templates.md</code> and <code>docs/admin-templates.md</code> in the
        package. WYSIWYG/block builders are not included in this release.
      </p>
    </div>
  )
}

export default TemplateEngineHelp
