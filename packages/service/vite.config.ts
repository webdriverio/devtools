import url from 'node:url'
import path from 'node:path'
import dts from 'vite-plugin-dts'
import { defineConfig } from 'vite'

const __dirname = url.fileURLToPath(new URL('.', import.meta.url))

/** Workspace-internal `@wdio/devtools-*` packages, by directory name. */
const PRIVATE_WORKSPACE_PACKAGES = ['core', 'shared', 'trace']

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
      // Inline private workspace packages — they are not published, so the
      // dist must not contain runtime `import` statements for them. The `id`
      // here can be EITHER the unresolved package name OR an already-resolved
      // absolute path (vite resolves workspace symlinks before calling this),
      // so both forms are checked. A package missing from this list is
      // silently externalized and the dist then dies at install time with
      // ERR_MODULE_NOT_FOUND, so it is a list rather than a chain of ors.
      // See CLAUDE.md §2.6.
      external: (id) => {
        const isPrivateWorkspaceDep = PRIVATE_WORKSPACE_PACKAGES.some(
          (name) =>
            id === `@wdio/devtools-${name}` ||
            id.startsWith(`@wdio/devtools-${name}/`) ||
            id.includes(`/packages/${name}/`)
        )
        if (isPrivateWorkspaceDep) {
          return false
        }

        // Any relative import (`./foo.js` from top-level, OR `../foo.js`
        // from a subfolder like utils/) and any absolute path under src/
        // must be bundled, not externalized. The `../` case was missing
        // before and caused constants.ts to leak as a non-emitted external
        // import once utils/ subfolder modules started importing it.
        return (
          !id.startsWith(path.resolve(__dirname, 'src')) &&
          !id.startsWith('./') &&
          !id.startsWith('../')
        )
      }
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
