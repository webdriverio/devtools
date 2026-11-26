import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts', 'src/locators/index.ts'],
  format: ['esm'],
  // Root `paths` with bundler resolution reach the private packages' sources, so their types are inlined rather than imported from a package consumers cannot install.
  dts: {
    compilerOptions: {
      baseUrl: '../..',
      rootDir: '../..',
      module: 'esnext',
      moduleResolution: 'bundler'
    }
  },
  splitting: false,
  sourcemap: true,
  clean: true,
  platform: 'node',
  outDir: 'dist'
})
