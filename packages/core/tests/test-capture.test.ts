import { describe, it, expect } from 'vitest'
import type { ActionSnapshot } from '@wdio/devtools-shared'
import { SessionCapturerBase } from '../src/session-capturer.js'

class TestCapturer extends SessionCapturerBase {
  readonly snapshots: ActionSnapshot[] = []
  readonly pending: Promise<void>[] = []

  queue(
    command: string,
    timestamp: number,
    changesPage: boolean,
    capture: () => Promise<ActionSnapshot | null>
  ) {
    return this.testCapture.queue(
      command,
      timestamp,
      changesPage,
      this.snapshots,
      this.pending,
      capture
    )
  }
}

const withScreenshot = (timestamp: number): Promise<ActionSnapshot> =>
  Promise.resolve({ timestamp, command: 'x', screenshot: 'png' })
const withoutScreenshot = (timestamp: number): Promise<ActionSnapshot> =>
  Promise.resolve({ timestamp, command: 'x' })

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

describe('TestCapture', () => {
  it('clears the initial frame only on a capture that holds a screenshot', async () => {
    const capturer = new TestCapturer()
    capturer.queue('getText', 1, false, () => withScreenshot(1))
    await Promise.all(capturer.pending)

    expect(capturer.testCapture.awaitingInitialFrame).toBe(false)
    expect(capturer.testCapture.initialFrameRetried).toBe(false)
    expect(capturer.snapshots.map((s) => s.timestamp)).toEqual([1])
  })

  it('retries the initial frame once when its capture has no screenshot', async () => {
    const capturer = new TestCapturer()
    capturer.queue('getText', 1, false, () => withoutScreenshot(1))
    await Promise.all(capturer.pending)
    expect(capturer.testCapture.awaitingInitialFrame).toBe(true)
    expect(capturer.testCapture.initialFrameRetried).toBe(true)

    capturer.queue('getText', 2, false, () => withoutScreenshot(2))
    await Promise.all(capturer.pending)
    expect(capturer.testCapture.awaitingInitialFrame).toBe(false)

    capturer.queue('getText', 3, false, () => withoutScreenshot(3))
    await Promise.all(capturer.pending)
    expect(capturer.testCapture.awaitingInitialFrame).toBe(false)
  })

  it('returns no capture for a read that is not the initial frame', () => {
    const capturer = new TestCapturer()
    capturer.queue('getText', 1, false, () => withScreenshot(1))
    const skipped = capturer.queue('getText', 2, false, () => withScreenshot(2))

    expect(skipped).toBeUndefined()
    expect(capturer.testCapture.lastCapturedTimestamp).toBe(1)
  })

  it('ignores a capture that resolves after resetTestCapture()', async () => {
    const capturer = new TestCapturer()
    const stale = deferred<ActionSnapshot | null>()
    capturer.queue('click', 1, true, () => stale.promise)
    capturer.resetTestCapture()

    stale.resolve({ timestamp: 1, command: 'click' })
    await Promise.all(capturer.pending)

    expect(capturer.testCapture.awaitingInitialFrame).toBe(true)
    expect(capturer.testCapture.initialFrameRetried).toBe(false)
  })

  it('resetTestCapture re-arms the initial frame and restamps the test start', () => {
    const capturer = new TestCapturer()
    capturer.queue('click', 1, true, () => withScreenshot(1))
    const generation = capturer.testCapture.generation
    const before = Date.now()

    capturer.resetTestCapture()

    expect(capturer.testCapture.awaitingInitialFrame).toBe(true)
    expect(capturer.testCapture.initialFrameRetried).toBe(false)
    expect(capturer.testCapture.generation).toBe(generation + 1)
    expect(capturer.testCapture.startWallTime).toBeGreaterThanOrEqual(before)
    expect(capturer.testCapture.startWallTime).toBeLessThanOrEqual(Date.now())
  })
})
