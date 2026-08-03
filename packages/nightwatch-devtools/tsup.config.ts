import { defineConfig } from 'tsup'

// Two outputs:
//  1. The plugin itself (ESM) — src/index.ts. Same as the original build.
//  2. The Cucumber hooks. Cucumber loads dist/helpers/cucumberHooks.cjs itself
//     via `require: [cucumberHooksPath]`, so it must be a self-contained CJS
//     module at that exact path. Bundle it so `require('../constants.js')`
//     (PLUGIN_GLOBAL_KEY) is inlined and no longer needs a sibling in dist; keep
//     `@cucumber/cucumber` external so the hooks share the user project's
//     Cucumber singleton at runtime. Without this entry the .cjs never exists
//     and Cucumber registers no devtools hooks (see CLAUDE.md known debt).
export default defineConfig([
  {
    entry: ['src/index.ts'],
    format: ['esm'],
    dts: true,
    sourcemap: true,
    clean: true
  },
  {
    entry: { 'helpers/cucumberHooks': 'src/helpers/cucumberHooks.cts' },
    format: ['cjs'],
    outExtension: () => ({ js: '.cjs' }),
    external: ['@cucumber/cucumber'],
    bundle: true,
    clean: false
  }
])
