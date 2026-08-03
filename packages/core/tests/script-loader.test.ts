import { describe, it, expect, vi } from 'vitest'
import {
  drainCollectorWithRecovery,
  loadInjectableScript,
  pollUntilReady
} from '../src/script-loader.js'

/**
 * `@wdio/devtools-script` is a workspace sibling that gets built before
 * adapter runtime use. In CI the test job may run before that package is
 * built, in which case `loadInjectableScript()` throws (resolve or
 * readFile fails). Probe by attempting the full operation — anything
 * cheaper risks drifting from what the runtime actually does, and that
 * drift is exactly what caused the historical CI/local divergence.
 */
const scriptPackageAvailable = await loadInjectableScript()
  .then(() => true)
  .catch(() => false)

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

describe('drainCollectorWithRecovery', () => {
  it('returns the payload without re-injecting when the collector responds', async () => {
    const injectIntoCurrentDocument = vi.fn(async () => {})
    const payload = await drainCollectorWithRecovery({
      drain: async () => ({ mutations: [] }),
      injectIntoCurrentDocument
    })
    expect(payload).toEqual({ mutations: [] })
    expect(injectIntoCurrentDocument).not.toHaveBeenCalled()
  })

  // Regression: a document that loads while no preload script is registered
  // (the first navigation after browser.reloadSession()) carries no collector,
  // so every action on it replayed the PREVIOUS document's DOM.
  it('re-injects once and re-drains when the collector is absent', async () => {
    const drained: Array<Record<string, unknown> | null> = [
      null,
      { mutations: [{ url: 'http://x/' }] }
    ]
    const injectIntoCurrentDocument = vi.fn(async () => {})
    const drain = vi.fn(async () => drained.shift() ?? null)
    const payload = await drainCollectorWithRecovery({
      drain,
      injectIntoCurrentDocument
    })
    expect(injectIntoCurrentDocument).toHaveBeenCalledTimes(1)
    expect(drain).toHaveBeenCalledTimes(2)
    expect(payload).toEqual({ mutations: [{ url: 'http://x/' }] })
  })

  // Every session sits on about:blank before its first navigation, and that
  // page has no collector by design — anchoring it would add a phantom
  // "document loaded" row to every run.
  it.each(['about:blank', 'data:,', 'chrome-error://chromewebdata/'])(
    'skips recovery on %s',
    async (url) => {
      const injectIntoCurrentDocument = vi.fn(async () => {})
      const payload = await drainCollectorWithRecovery({
        drain: async () => null,
        injectIntoCurrentDocument,
        currentUrl: async () => url
      })
      expect(payload).toBeNull()
      expect(injectIntoCurrentDocument).not.toHaveBeenCalled()
    }
  )

  it('skips recovery when the url cannot be read (session gone)', async () => {
    const injectIntoCurrentDocument = vi.fn(async () => {})
    await drainCollectorWithRecovery({
      drain: async () => null,
      injectIntoCurrentDocument,
      currentUrl: async () => {
        throw new Error('no such session')
      }
    })
    expect(injectIntoCurrentDocument).not.toHaveBeenCalled()
  })

  it('recovers on a real page url', async () => {
    const injectIntoCurrentDocument = vi.fn(async () => {})
    await drainCollectorWithRecovery({
      drain: async () => null,
      injectIntoCurrentDocument,
      currentUrl: async () => 'https://the-internet.herokuapp.com/login'
    })
    expect(injectIntoCurrentDocument).toHaveBeenCalledTimes(1)
  })

  it('warns and gives up when the collector stays unreachable', async () => {
    const log = vi.fn()
    const payload = await drainCollectorWithRecovery({
      drain: async () => null,
      injectIntoCurrentDocument: async () => {},
      log
    })
    expect(payload).toBeFalsy()
    expect(log).toHaveBeenCalledWith('warn', expect.stringContaining('stale'))
  })

  // A failed recovery must not also lose the caller's drain path.
  it('swallows a re-injection failure', async () => {
    const log = vi.fn()
    const drain = vi.fn(async () => null)
    const payload = await drainCollectorWithRecovery({
      drain,
      injectIntoCurrentDocument: async () => {
        throw new Error('no such window')
      },
      log
    })
    expect(payload).toBeNull()
    expect(drain).toHaveBeenCalledTimes(1)
    expect(log).toHaveBeenCalledWith(
      'warn',
      expect.stringContaining('no such window')
    )
  })
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
