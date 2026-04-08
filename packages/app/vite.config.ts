import url from 'node:url'
import path from 'node:path'
import { defineConfig } from 'vite'
import Icons from 'unplugin-icons/vite'
import { FileSystemIconLoader } from 'unplugin-icons/loaders'

const __dirname = url.fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      // Force all codemirror packages to use the same @codemirror/state instance,
      // preventing the "multiple instances" error when mixing codemirror meta-package
      // with direct @codemirror/* imports under pnpm.
      '@codemirror/state': path.resolve(
        __dirname,
        '../../node_modules/.pnpm/@codemirror+view@6.41.0/node_modules/@codemirror/state'
      ),
      '@': path.resolve(__dirname, './src'),
      '@core': path.resolve(__dirname, './src/core'),
      '@components': path.resolve(__dirname, './src/components'),
      '@wdio/devtools-service/types': path.resolve(
        __dirname,
        '../service/src/types.js'
      )
    }
  },
  css: {
    postcss: './postcss.config.cjs'
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
  ]
})
