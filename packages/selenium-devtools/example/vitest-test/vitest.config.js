import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    testTimeout: 60000,
    hookTimeout: 60000,
    include: ['example/vitest-test/test/**/*.test.js'],
    setupFiles: ['./example/vitest-test/setup.js'],
    // Single fork keeps one DevTools backend across files. The plugin
    // patches selenium-webdriver at module load — running in worker threads
    // would multiplex that against shared imports.
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } }
  }
})
