import { defineConfig } from 'tsup'

import { INLINE_PRIVATE_TYPES } from '../../tsup.dts.js'

// vite builds the JavaScript; this builds one declaration bundle per entry the exports map names.
export default defineConfig({
  entry: ['src/index.ts', 'src/launcher.ts', 'src/types.ts'],
  format: ['esm'],
  dts: { ...INLINE_PRIVATE_TYPES, only: true },
  clean: false
})
