import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      // Pins the denominator to the source tree. Without `include`, vitest 4
      // reports only the files some test happened to import — 176 of 256 today —
      // so 3.3k uncovered statements sat in no denominator at all, and deleting
      // the one test that touched a weak module RAISED the percentage. Every
      // source file now counts whether a test reaches it or not.
      include: ['packages/*/src/**/*.ts'],
      exclude: [
        'node_modules/',
        'dist/',
        '**/*.d.ts',
        '**/*.config.*',
        '**/tests/**',
        'example/**',
        // The only two genuine re-export barrels (zero non-export lines each).
        // The other `src/index.ts` files are not barrels — service (1018 lines),
        // nightwatch (789), selenium (767) and backend (455) are the plugin
        // god-files and the server entry — so they stay in the denominator even
        // though they are largely uncovered.
        'packages/{shared,core}/src/index.ts',
        // Type-only declaration modules: no statements to cover.
        '**/src/types.ts',
        // The app's rendering layer. A node test cannot import a Lit element
        // (`HTMLElement is not defined`), so these could only ever read 0% here
        // and every new component would fail the gate for no real reason. Their
        // cover comes from the component suite: `COVERAGE=1 pnpm test:ui`
        // measures packages/app/src at 80-84% and reports it (no floor there yet
        // — see the note in packages/app/wdio.conf.ts for why). The
        // trade-off is that the pure helpers living beside those components are
        // gated there rather than here, even though node tests exercise them.
        'packages/app/src/components/**',
        'packages/app/src/app.ts',
        'packages/app/src/core/element.ts'
      ],
      thresholds: {
        lines: 60.61,
        branches: 55.41,
        functions: 58,
        statements: 60.78
      }
    },
    include: ['packages/**/tests/**/*.test.ts'],
    // test-ui holds WDIO component specs: they need a real browser, the app's
    // Vite config (icons compile to web components, so importing one in node
    // throws `HTMLElement is not defined`) and the runner's injected globals.
    // Excluded explicitly so an editor cannot run them through this config.
    exclude: ['**/node_modules/**', '**/dist/**', '**/test-ui/**']
    // Script tests that need a DOM (`networkRequests.test.ts`,
    // `utils.test.ts`) declare `@vitest-environment happy-dom` per-file.
    // vitest 4 deprecated `environmentMatchGlobs` in favor of `projects`,
    // but the per-file directive is simpler and matches the actual surface.
  }
})
