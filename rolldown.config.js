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
    },
    external: ['payload', 'react', 'react-dom', 'react/jsx-runtime', '@payloadcms/ui'],
  },
])
