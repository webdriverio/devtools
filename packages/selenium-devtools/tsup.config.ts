import { defineConfig } from 'tsup'

import { INLINE_PRIVATE_TYPES } from '../../tsup.dts.js'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: INLINE_PRIVATE_TYPES,
  sourcemap: true,
  clean: true
})
