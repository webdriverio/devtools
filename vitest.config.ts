import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'dist/',
        '**/*.d.ts',
        '**/*.config.*',
        '**/tests/**',
        'example/**',
        // Pure re-export barrels — counted by the coverage tool but contain
        // no logic. Including them drags the % down for no functional reason.
        '**/src/index.ts',
        '**/src/types.ts'
      ],
      // Floor for `pnpm test:coverage`, which NOTHING RUNS IN CI (`ci.yml`
      // runs `pnpm test`, `pnpm lint`, `pnpm test:ui`) — so these numbers gate
      // nothing today and the suite is currently below all four. Two reasons
      // to fix the measurement before the numbers: the denominator counts
      // every Lit component in `packages/app/src`, while the component specs
      // that exercise them run in a real browser under `test:ui` and
      // contribute no v8 coverage at all; and `include` only collects from
      // `packages/**/tests/**`. Ratchet upward as gaps close, never downward.
      thresholds: {
        lines: 85,
        branches: 77,
        functions: 86,
        statements: 85
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
