import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

// Standalone from the root vitest project: the verification suite reads golden
// fixtures (produced by `pnpm fixtures:regen`), so it must stay out of
// `pnpm test` and the coverage gate. Run it with `pnpm verify`.
const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
)

export default defineConfig({
  root: repoRoot,
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**']
  }
})
