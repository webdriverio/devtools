import url from 'node:url'
import path from 'node:path'
import dts from 'vite-plugin-dts'
import { defineConfig } from 'vite'

const __dirname = url.fileURLToPath(new URL('.', import.meta.url))

// https://vitejs.dev/config/
export default defineConfig({
  optimizeDeps: {
    esbuildOptions: {
      target: 'esnext',
    },
  },
  build: {
    lib: {
      entry: path.resolve(__dirname, 'src', 'index.ts'),
      name: 'hook',
      formats: ['es'],
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
        types: path.resolve(__dirname, 'src', 'types.ts')
      },
      output: {
        entryFileNames: '[name].js',
      },
      external: (id) => !id.startsWith(path.resolve(__dirname, 'src')) && !id.startsWith('./')
    }
  },
  plugins: [dts({
    root: __dirname,
    entryRoot: 'src'
  })]
})
