import { defineConfig } from 'rolldown'

export default defineConfig([
  {
    input: {
      index: 'src/index.ts',
      browser: 'src/browser.ts',
    },
    output: {
      dir: 'dist',
      format: 'esm',
      entryFileNames: '[name].mjs',
    },
    external: ['payload'],
  },
  {
    input: {
      'admin/index': 'src/admin/index.ts',
    },
    output: {
      dir: 'dist',
      format: 'esm',
      entryFileNames: '[name].mjs',
      // Bundling drops the source files' `'use client'` directives; Payload must import
      // these components as client components.
      banner: "'use client'",
    },
    external: ['payload', 'react', 'react-dom', 'react/jsx-runtime', '@payloadcms/ui'],
  },
])
