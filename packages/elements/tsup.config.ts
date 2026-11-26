import { defineConfig } from 'tsup'

import { INLINE_PRIVATE_TYPES } from '../../tsup.dts.js'

export default defineConfig({
  entry: ['src/index.ts', 'src/locators/index.ts'],
  format: ['esm'],
  dts: INLINE_PRIVATE_TYPES,
  splitting: false,
  sourcemap: true,
  clean: true,
  platform: 'node',
  outDir: 'dist'
})
