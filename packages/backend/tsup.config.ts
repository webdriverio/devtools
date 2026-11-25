import { defineConfig } from 'tsup'

import { INLINE_PRIVATE_TYPES } from '../../tsup.dts.js'

export default defineConfig({
  entry: ['src/index.ts', 'src/show-trace.ts', 'src/server.ts'],
  format: ['esm'],
  dts: INLINE_PRIVATE_TYPES,
  clean: true
})
