import url from 'node:url'
import path from 'node:path'
import dts from 'vite-plugin-dts'
import { defineConfig } from 'vite'

const __dirname = url.fileURLToPath(new URL('.', import.meta.url))

// https://vitejs.dev/config/
export default defineConfig({
  build: {
    lib: {
      entry: path.resolve(__dirname, 'src', 'index.ts'),
      name: 'hook',
      fileName: 'index',
      formats: ['es'],
    },
    target: 'node20',
    rollupOptions: {
      external: (id) => !id.startsWith(path.resolve(__dirname, 'src')) && !id.startsWith('./')
    }
  },
  plugins: [dts()]
})
