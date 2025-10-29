import url from 'node:url'
import path from 'node:path'
import { defineConfig } from 'vite'
import Icons from 'unplugin-icons/vite'
import { FileSystemIconLoader } from 'unplugin-icons/loaders'

const __dirname = url.fileURLToPath(new URL('.', import.meta.url))

// https://vitejs.dev/config/
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@core': path.resolve(__dirname, './src/core'),
      '@components': path.resolve(__dirname, './src/components')
    }
  },
  plugins: [
    Icons({
      compiler: 'web-components',
      webComponents: {
        autoDefine: true,
        shadow: false
      },
      customCollections: {
        custom: FileSystemIconLoader('./src/assets/icons')
      }
    })
  ],
  build: {
    rollupOptions: {
      external: ['@wdio/devtools-service/types']
    }
  }
})
