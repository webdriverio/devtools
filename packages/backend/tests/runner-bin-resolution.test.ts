/**
 * The wdio binary is resolved where it is used, not when the module loads.
 *
 * It used to be a module-scope `const`, and `resolveWdioBin` throws when it
 * cannot resolve — so an absent or unresolvable `@wdio/cli` killed the whole
 * backend at import, before it served anything, for Nightwatch, Selenium and
 * Python users who never reach the wdio branch at all. The error they got
 * named a WDIO env var they had never heard of.
 *
 * Note this file mocks nothing. `runner.test.ts` has to stub `node:module`
 * "to prevent resolveWdioBin from failing during import" — that workaround is
 * the bug, written down. Here the import must simply work.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { RUNNER_ENV } from '@wdio/devtools-shared'

const original = process.env[RUNNER_ENV.WDIO_BIN]

beforeEach(() => {
  process.env[RUNNER_ENV.WDIO_BIN] = '/nonexistent/does-not-exist/wdio.js'
})

afterEach(() => {
  if (original === undefined) {
    delete process.env[RUNNER_ENV.WDIO_BIN]
  } else {
    process.env[RUNNER_ENV.WDIO_BIN] = original
  }
})

describe('runner module import', () => {
  it('loads with an unresolvable wdio binary', async () => {
    const mod = await import('../src/runner.js')
    expect(mod.testRunner).toBeDefined()
  })

  // The resolution still has to happen — and still has to fail loudly — at the
  // point a WDIO rerun actually needs the binary.
  it('still rejects an unresolvable binary when one is asked for', async () => {
    const { resolveWdioBin } = await import('../src/bin-resolver.js')
    expect(() => resolveWdioBin()).toThrow(/does not exist|not accessible/)
  })
})
