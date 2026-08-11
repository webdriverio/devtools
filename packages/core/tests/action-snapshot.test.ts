import { describe, it, expect, vi } from 'vitest'
import { captureActionSnapshot } from '../src/action-snapshot.js'
import { SNAPSHOT_DRIVER_PROBE_TIMEOUT_MS } from '../src/with-timeout.js'

const okScript = () => Promise.resolve([])

describe('captureActionSnapshot timestamp', () => {
  it('stamps the caller-supplied command timestamp', async () => {
    // Export claims snapshots by exact equality with the command timestamp, so
    // the caller — not the capture — owns the stamp.
    const snap = await captureActionSnapshot({
      command: 'click',
      timestamp: 4242,
      runScript: okScript,
      takeScreenshot: () => Promise.resolve('AA')
    })
    expect(snap?.timestamp).toBe(4242)
  })

  it('falls back to capture time when no timestamp is given', async () => {
    const before = Date.now()
    const snap = await captureActionSnapshot({
      command: 'click',
      runScript: okScript
    })
    const after = Date.now()
    expect(snap?.timestamp).toBeGreaterThanOrEqual(before)
    expect(snap?.timestamp).toBeLessThanOrEqual(after)
  })

  it('honours the supplied timestamp on the native-mobile path', async () => {
    // No runScript + a page source is what selects the mobile branch; the stamp
    // must survive the different snapshot-text path.
    const snap = await captureActionSnapshot({
      command: 'click',
      timestamp: 777,
      getPageSource: () => Promise.resolve('<hierarchy />'),
      platform: 'android'
    })
    expect(snap?.timestamp).toBe(777)
  })

  it('stamps a zero timestamp rather than treating it as absent', async () => {
    const snap = await captureActionSnapshot({
      command: 'click',
      timestamp: 0,
      runScript: okScript
    })
    expect(snap?.timestamp).toBe(0)
  })
})

describe('captureActionSnapshot probe isolation', () => {
  it('still resolves when a driver probe never settles', async () => {
    // Nightwatch's url/title readers are QUEUED commands: called from inside the
    // plugin's own command hook they enqueue behind the running command and can
    // never resolve. Unguarded, one of them stranded the whole capture and the
    // action reached the trace with no DOM at all.
    vi.useFakeTimers()
    const capture = captureActionSnapshot({
      command: 'click',
      timestamp: 10,
      runScript: okScript,
      getUrl: () => new Promise<string>(() => {}),
      takeScreenshot: () => Promise.resolve('AA')
    })
    await vi.advanceTimersByTimeAsync(SNAPSHOT_DRIVER_PROBE_TIMEOUT_MS + 1)
    const snap = await capture
    vi.useRealTimers()
    expect(snap?.timestamp).toBe(10)
    expect(snap?.url).toBeUndefined()
    expect(snap?.screenshot).toBe('AA')
  })

  it('absorbs a probe that throws synchronously', async () => {
    const snap = await captureActionSnapshot({
      command: 'click',
      timestamp: 11,
      runScript: okScript,
      getTitle: () => {
        throw new Error('no such session')
      },
      takeScreenshot: () => Promise.resolve('BB')
    })
    expect(snap?.title).toBeUndefined()
    expect(snap?.screenshot).toBe('BB')
  })

  it('takes a null url/title the same way it takes a null screenshot', async () => {
    // A raw-transport reader answers `null` on a failed read rather than
    // rejecting, so the probes accept it and normalize it to `undefined` — the
    // adapters must not have to coerce it themselves.
    const snap = await captureActionSnapshot({
      command: 'click',
      timestamp: 13,
      runScript: okScript,
      getUrl: () => Promise.resolve(null),
      getTitle: () => Promise.resolve(null),
      takeScreenshot: () => Promise.resolve(null)
    })
    expect(snap?.url).toBeUndefined()
    expect(snap?.title).toBeUndefined()
    expect(snap?.screenshot).toBeUndefined()
  })

  it('absorbs a rejecting screenshot without losing the rest', async () => {
    const snap = await captureActionSnapshot({
      command: 'click',
      timestamp: 12,
      runScript: okScript,
      getUrl: () => Promise.resolve('https://example.com/x'),
      takeScreenshot: () => Promise.reject(new Error('boom'))
    })
    expect(snap?.screenshot).toBeUndefined()
    expect(snap?.url).toBe('https://example.com/x')
  })
})

describe('captureActionSnapshot locator dialect', () => {
  /** Both injected script bodies, as the adapter's runScript receives them. */
  async function injectedScripts(
    input: Parameters<typeof captureActionSnapshot>[0]
  ): Promise<string[]> {
    const scripts: string[] = []
    await captureActionSnapshot({
      ...input,
      runScript: (src) => {
        scripts.push(src)
        return Promise.resolve([])
      }
    })
    return scripts
  }

  it("threads the runner into both scripts' text branch", async () => {
    const scripts = await injectedScripts({ command: 'click', runner: 'mocha' })

    expect(scripts).toHaveLength(2)
    for (const src of scripts) {
      expect(src).toContain("tag + '*=' + text")
    }
  })

  it('keeps the portable XPath form for a runner without its own syntax', async () => {
    const scripts = await injectedScripts({
      command: 'click',
      runner: 'nightwatch'
    })

    for (const src of scripts) {
      expect(src).not.toContain("tag + '*=' + text")
      expect(src).toContain("'[contains(., '")
    }
  })

  it('defaults to the portable form when no runner is given', async () => {
    const scripts = await injectedScripts({ command: 'click' })

    for (const src of scripts) {
      expect(src).not.toContain("tag + '*=' + text")
    }
  })
})
