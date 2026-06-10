import { afterEach, describe, it, expect, vi, beforeEach } from 'vitest'
import { loadInjectableScript } from '@wdio/devtools-core'
import { SessionCapturer } from '../src/session.js'
import { getDriverOriginals } from '../src/driverPatcher.js'

// `@wdio/devtools-script` is a workspace sibling that may not be built
// yet in a CI test job that runs before the script-package build step.
// injectScript() calls loadInjectableScript() (resolve + readFile), so
// the probe attempts the same operation — checking only resolution
// against the TEST file's node_modules tree historically drifted from
// what the runtime actually does inside @wdio/devtools-core.
const scriptPackageAvailable = await loadInjectableScript()
  .then(() => true)
  .catch(() => false)

function makeCapturer(driver?: unknown): SessionCapturer {
  return new SessionCapturer({}, driver as never)
}

describe('selenium SessionCapturer.captureCommand', () => {
  it('pushes a CommandLog with _id and id set to the same counter value', async () => {
    const cap = makeCapturer()
    const entry = await cap.captureCommand(
      'click',
      ['#btn'],
      { ok: true },
      undefined
    )
    expect(entry._id).toBeDefined()
    expect((entry as { id?: number }).id).toBe(entry._id)
    expect(cap.commandsLog).toHaveLength(1)
  })

  it('serializes Error into a plain object', async () => {
    const cap = makeCapturer()
    const err = new Error('boom')
    const entry = await cap.captureCommand('x', [], undefined, err)
    expect((entry.error as { name: string; message: string }).name).toBe(
      'Error'
    )
  })

  it('uses provided timestamp when given', async () => {
    const cap = makeCapturer()
    const entry = await cap.captureCommand(
      'x',
      [],
      undefined,
      undefined,
      undefined,
      undefined,
      9999
    )
    expect(entry.timestamp).toBe(9999)
  })
})

describe('selenium SessionCapturer.replaceCommand', () => {
  it('mutates the existing entry in place and preserves _id/id', async () => {
    const cap = makeCapturer()
    const orig = await cap.captureCommand('click', ['#a'], undefined, undefined)
    const origId = orig._id!
    const origTs = orig.timestamp
    const { entry, oldTimestamp } = cap.replaceCommand(
      origId,
      'click',
      ['#a'],
      { ok: true },
      undefined
    )
    expect(oldTimestamp).toBe(origTs)
    expect(cap.commandsLog).toHaveLength(1)
    expect(entry._id).toBe(origId)
    expect(entry.result).toEqual({ ok: true })
  })

  it('appends a fresh entry with new _id when oldId not found, oldTimestamp=0', async () => {
    const cap = makeCapturer()
    const { entry, oldTimestamp } = cap.replaceCommand(
      999,
      'x',
      [],
      'result',
      undefined
    )
    expect(oldTimestamp).toBe(0)
    expect(cap.commandsLog).toHaveLength(1)
    expect(entry.result).toBe('result')
  })
})

describe('selenium SessionCapturer.isNavigationCommand', () => {
  it.each([
    ['get', true],
    ['navigate', true],
    ['url', false],
    ['click', false]
  ])('isNavigationCommand(%s) → %s', (command, expected) => {
    const cap = makeCapturer()
    expect(cap.isNavigationCommand(command)).toBe(expected)
  })
})

describe('selenium SessionCapturer.takeScreenshot', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns null when no driver is set', async () => {
    const cap = makeCapturer()
    expect(await cap.takeScreenshot()).toBeNull()
  })

  it('returns null when takeScreenshot original is not stashed', async () => {
    // Driver present but no original stashed → null
    const cap = makeCapturer({ id: 'driver' })
    expect(await cap.takeScreenshot()).toBeNull()
  })
})

describe('selenium SessionCapturer.captureBrowserLogs', () => {
  it('no-ops when no driver set', async () => {
    const cap = makeCapturer()
    await expect(cap.captureBrowserLogs()).resolves.toBeUndefined()
    expect(cap.consoleLogs).toHaveLength(0)
  })

  it('no-ops when driver set but no manage() stashed', async () => {
    const cap = makeCapturer({ id: 'd' })
    await expect(cap.captureBrowserLogs()).resolves.toBeUndefined()
    expect(cap.consoleLogs).toHaveLength(0)
  })
})

describe('selenium SessionCapturer.injectScript', () => {
  it('no-ops when no driver set', async () => {
    const cap = makeCapturer()
    await expect(cap.injectScript()).resolves.toBeUndefined()
  })

  it('no-ops when driver set but no executeScript stashed', async () => {
    const cap = makeCapturer({ id: 'd' })
    await expect(cap.injectScript()).resolves.toBeUndefined()
  })
})

describe('selenium SessionCapturer.captureTrace', () => {
  it('no-ops when no driver set', async () => {
    const cap = makeCapturer()
    await expect(cap.captureTrace()).resolves.toBeUndefined()
  })

  it('no-ops when driver set but no executeScript stashed', async () => {
    const cap = makeCapturer({ id: 'd' })
    await expect(cap.captureTrace()).resolves.toBeUndefined()
  })
})

// Direct mutation of the singleton driverOriginals bag is the
// least-painful way to exercise the executeScript-dependent paths
// without standing up a real selenium-webdriver. Always restore in
// afterEach so we don't leak state between tests.
describe('selenium SessionCapturer (with stashed executeScript)', () => {
  let restoreExec: (() => void) | undefined

  afterEach(() => {
    restoreExec?.()
    restoreExec = undefined
  })

  function stubExec(impl: (...args: unknown[]) => unknown) {
    const originals = getDriverOriginals()
    const prev = originals.executeScript
    originals.executeScript = impl as (typeof originals)['executeScript']
    restoreExec = () => {
      if (prev) {
        originals.executeScript = prev
      } else {
        delete originals.executeScript
      }
    }
  }

  it.skipIf(!scriptPackageAvailable)(
    'injectScript runs to completion when collector becomes ready',
    async () => {
      let scriptInjected = false
      let collectorReadyCalls = 0
      stubExec(async (_driver, script) => {
        const s = String(script)
        if (s.includes('createElement')) {
          scriptInjected = true
          return true
        }
        if (s.includes('wdioTraceCollector')) {
          collectorReadyCalls++
          return collectorReadyCalls >= 1
        }
        return undefined
      })
      const cap = makeCapturer({ id: 'd' })
      await cap.injectScript()
      expect(scriptInjected).toBe(true)
      expect(collectorReadyCalls).toBeGreaterThanOrEqual(1)
    }
  )

  it('injectScript swallows ECONNREFUSED / no-such-session errors silently', async () => {
    stubExec(async () => {
      throw new Error('ECONNREFUSED')
    })
    const cap = makeCapturer({ id: 'd' })
    await expect(cap.injectScript()).resolves.toBeUndefined()
  })

  it('captureTrace early-returns when collector is not present', async () => {
    stubExec(async () => false)
    const cap = makeCapturer({ id: 'd' })
    await expect(cap.captureTrace()).resolves.toBeUndefined()
  })

  it('captureTrace early-returns when getTraceData returns falsy', async () => {
    let call = 0
    stubExec(async () => {
      call++
      return null
    })
    const cap = makeCapturer({ id: 'd' })
    await expect(cap.captureTrace()).resolves.toBeUndefined()
    // Single atomic check+read in one executeScript — see session.ts comment.
    expect(call).toBe(1)
  })

  it('captureTrace processes payload when collector returns data', async () => {
    let call = 0
    stubExec(async () => {
      call++
      return {
        mutations: [],
        networkRequests: [],
        consoleLogs: []
      }
    })
    const cap = makeCapturer({ id: 'd' })
    await cap.captureTrace()
    expect(call).toBe(1)
  })

  it('captureTrace swallows ECONNREFUSED / no-such-session errors silently', async () => {
    stubExec(async () => {
      throw new Error('invalid session id')
    })
    const cap = makeCapturer({ id: 'd' })
    await expect(cap.captureTrace()).resolves.toBeUndefined()
  })
})

describe('selenium SessionCapturer.awaitClientConnected', () => {
  it('resolves immediately if client already connected', async () => {
    const cap = makeCapturer()
    // simulate connect via onWsMessage
    ;(cap as unknown as { onWsMessage: (m: unknown) => void }).onWsMessage({
      scope: 'clientConnected'
    })
    await expect(cap.awaitClientConnected()).resolves.toBeUndefined()
  })

  it('blocks until a clientConnected message arrives', async () => {
    const cap = makeCapturer()
    let resolved = false
    const p = cap.awaitClientConnected().then(() => {
      resolved = true
    })
    await new Promise((r) => setTimeout(r, 10))
    expect(resolved).toBe(false)
    ;(cap as unknown as { onWsMessage: (m: unknown) => void }).onWsMessage({
      scope: 'clientConnected'
    })
    await p
    expect(resolved).toBe(true)
  })

  it('invokes setClientDisconnectedHandler on clientDisconnected scope', () => {
    const cap = makeCapturer()
    const fn = vi.fn()
    cap.setClientDisconnectedHandler(fn)
    ;(cap as unknown as { onWsMessage: (m: unknown) => void }).onWsMessage({
      scope: 'clientDisconnected'
    })
    expect(fn).toHaveBeenCalled()
  })
})

describe('selenium SessionCapturer.setDriver', () => {
  it('updates the driver reference', () => {
    const cap = makeCapturer()
    const driver = { id: 'd1' }
    cap.setDriver(driver as never)
    // No direct getter exposed; verify via takeScreenshot path falling through
    // (driver-yes, original-no → null without throw)
    return cap.takeScreenshot().then((s) => expect(s).toBeNull())
  })
})
