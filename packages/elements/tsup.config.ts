import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts', 'src/locators/index.ts'],
  format: ['esm'],
  experimentalDts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  platform: 'node',
  outDir: 'dist'
})
