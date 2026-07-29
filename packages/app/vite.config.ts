import url from 'node:url'
import path from 'node:path'
import { defineConfig } from 'vite'
import Icons from 'unplugin-icons/vite'
import { FileSystemIconLoader } from 'unplugin-icons/loaders'

const __dirname = url.fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  resolve: {
    // Force all codemirror packages to use the same @codemirror/state instance,
    // preventing the "multiple instances" error when mixing codemirror meta-package
    // with direct @codemirror/* imports under pnpm.
    dedupe: ['@codemirror/state'],
    alias: {
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
    postcss: path.resolve(__dirname, './postcss.config.cjs')
  },
  plugins: [
    Icons({
      compiler: 'web-components',
      webComponents: {
        autoDefine: true,
        shadow: false
      },
      // Every path here is absolute because this config is also handed to the
      // component-test runner, whose Vite servers start in worker processes with
      // the repo root as cwd — the defaults resolve against cwd and every icon
      // then fails to load.
      collectionsNodeResolvePath: __dirname,
      customCollections: {
        custom: FileSystemIconLoader(
          path.resolve(__dirname, './src/assets/icons')
        )
      }
    })
  ]
})
