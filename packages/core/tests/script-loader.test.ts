import { createRequire } from 'node:module'
import { describe, it, expect, vi } from 'vitest'
import { loadInjectableScript, pollUntilReady } from '../src/script-loader.js'

/**
 * `@wdio/devtools-script` is a workspace sibling that gets built before
 * adapter runtime use. In CI the test job may run before that package is
 * built, in which case `require.resolve('@wdio/devtools-script')` throws.
 * Skip the integration assertion in that case rather than failing the
 * suite — the contract (IIFE wrap) is still asserted whenever the script
 * package is available.
 */
const scriptPackageAvailable = (() => {
  try {
    createRequire(import.meta.url).resolve('@wdio/devtools-script')
    return true
  } catch {
    return false
  }
})()

describe('loadInjectableScript', () => {
  it.skipIf(!scriptPackageAvailable)(
    'wraps the @wdio/devtools-script payload in an async IIFE',
    async () => {
      const wrapped = await loadInjectableScript()
      expect(wrapped.startsWith('(async function() { ')).toBe(true)
      expect(wrapped.endsWith(' })()')).toBe(true)
      // Body must be non-empty — the actual script.js is shipped by the
      // workspace build; this fails fast if the file is missing or empty.
      expect(wrapped.length).toBeGreaterThan('(async function() {  })()'.length)
    }
  )
})

describe('pollUntilReady', () => {
  it('returns true as soon as the check succeeds', async () => {
    let calls = 0
    const ok = await pollUntilReady(
      async () => {
        calls++
        return calls === 2
      },
      { attempts: 5, intervalMs: 1 }
    )
    expect(ok).toBe(true)
    expect(calls).toBe(2)
  })

  it('returns false when no attempt succeeds', async () => {
    const check = vi.fn(async () => false)
    const ok = await pollUntilReady(check, { attempts: 3, intervalMs: 1 })
    expect(ok).toBe(false)
    expect(check).toHaveBeenCalledTimes(3)
  })

  it('uses default 5 attempts × 200ms when no opts given', async () => {
    const check = vi.fn(async () => false)
    const start = process.hrtime.bigint()
    const ok = await pollUntilReady(check)
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1_000_000
    expect(ok).toBe(false)
    expect(check).toHaveBeenCalledTimes(5)
    // 5 × 200ms = 1000ms, allow generous slack for CI
    expect(elapsedMs).toBeGreaterThanOrEqual(950)
  })

  it('does not call the check before the first interval', async () => {
    const check = vi.fn(async () => true)
    await pollUntilReady(check, { attempts: 1, intervalMs: 50 })
    expect(check).toHaveBeenCalledTimes(1)
  })
})
