import url from 'node:url'
import path from 'node:path'
import dts from 'vite-plugin-dts'
import { defineConfig } from 'vite'

const __dirname = url.fileURLToPath(new URL('.', import.meta.url))

// https://vitejs.dev/config/
export default defineConfig({
  optimizeDeps: {
    esbuildOptions: {
      target: 'esnext'
    }
  },
  build: {
    lib: {
      entry: path.resolve(__dirname, 'src', 'index.ts'),
      name: 'hook',
      formats: ['es']
    },
    target: 'esnext',
    outDir: 'dist',
    emptyOutDir: false,
    /**
     * ensure we can import types from the package in the app (a web environment)
     */
    rollupOptions: {
      input: {
        index: path.resolve(__dirname, 'src', 'index.ts'),
        launcher: path.resolve(__dirname, 'src', 'launcher.ts'),
        types: path.resolve(__dirname, 'src', 'types.ts')
      },
      output: {
        entryFileNames: '[name].js'
      },
      // Inline private workspace packages (@wdio/devtools-core,
      // @wdio/devtools-shared) — they are not published, so the dist must
      // not contain runtime `import` statements for them. See CLAUDE.md §2.6.
      external: (id) =>
        !id.startsWith(path.resolve(__dirname, 'src')) &&
        !id.startsWith('./') &&
        id !== '@wdio/devtools-core' &&
        !id.startsWith('@wdio/devtools-core/') &&
        id !== '@wdio/devtools-shared' &&
        !id.startsWith('@wdio/devtools-shared/')
    }
  },
  plugins: [
    dts({
      root: __dirname,
      entryRoot: 'src',
      tsconfigPath: './tsconfig.build.json'
    })
  ]
})
