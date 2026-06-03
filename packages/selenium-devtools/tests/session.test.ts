import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SessionCapturer } from '../src/session.js'

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
