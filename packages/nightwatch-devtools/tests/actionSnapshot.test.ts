import type * as DevtoolsCore from '@wdio/devtools-core'
import { describe, it, expect, vi } from 'vitest'
import { captureActionSnapshot as coreCapture } from '@wdio/devtools-core'
import { SessionCapturer } from '../src/session.js'
import type { CommandLog, NightwatchBrowser } from '../src/types.js'

vi.mock('@wdio/devtools-core', async (importOriginal) => {
  const actual = await importOriginal<typeof DevtoolsCore>()
  return {
    ...actual,
    captureActionSnapshot: vi.fn(actual.captureActionSnapshot)
  }
})

function makeMockBrowser(): NightwatchBrowser {
  return {
    url: vi.fn(async () => ({})),
    execute: vi.fn(async () => ({ value: [] })),
    executeAsync: vi.fn(async () => ({ value: [] })),
    pause: vi.fn(async () => ({})),
    getCurrentUrl: vi.fn(async () => 'http://example.test/'),
    getTitle: vi.fn(async () => 'Example')
  } as unknown as NightwatchBrowser
}

/** No hostname/port → no WebSocket, so the capture surface is testable without
 *  a backend stub. Trace mode is what enables snapshot capture. */
function makeCapturer(): SessionCapturer {
  const cap = new SessionCapturer({}, makeMockBrowser())
  cap.traceMode = 'trace'
  return cap
}

describe('nightwatch action-snapshot timestamp binding', () => {
  it("stamps the snapshot with the logged command's timestamp", async () => {
    // Regression: the capture is fire-and-forget and resolves after the command
    // completes, so its own Date.now() never equalled cmd.timestamp — and the
    // exporter claims snapshots by exact equality, so nothing bound.
    const cap = makeCapturer()
    await cap.captureCommand('click', ['#btn'], undefined, undefined, {
      timestamp: 7777
    })
    await Promise.all(cap.snapshotCaptures)

    expect(cap.actionSnapshots).toHaveLength(1)
    expect(cap.actionSnapshots[0]!.timestamp).toBe(7777)
    expect(cap.actionSnapshots[0]!.timestamp).toBe(
      cap.commandsLog[0]!.timestamp
    )
    cap.cleanup()
  })

  it('takes no snapshot for an assertion row', async () => {
    // Assertion rows are emitted in a batch at test-end but positioned back on
    // their real execution window, so a capture here would probe the page as it
    // is now and stamp it seconds earlier. They inherit the preceding action's
    // capture at export instead (FrameSnapshotIndex.claimAfter).
    const cap = makeCapturer()
    const entry: CommandLog = {
      command: 'assert.titleContains',
      args: ['Example'],
      timestamp: 8888
    }
    cap.captureAssertCommand(entry)
    await Promise.all(cap.snapshotCaptures)

    expect(cap.actionSnapshots).toHaveLength(0)
    expect(cap.commandsLog).toHaveLength(1)
    cap.cleanup()
  })

  it('captures a click, but not a read or wait that follows it', async () => {
    const cap = makeCapturer()
    const at = (command: string, timestamp: number) =>
      cap.captureCommand(command, ['#el'], undefined, undefined, { timestamp })
    await at('click', 1)
    await at('getText', 2)
    await at('waitForElementVisible', 3)
    await Promise.all(cap.snapshotCaptures)

    expect(cap.actionSnapshots.map((s) => s.timestamp)).toEqual([1])
    expect(cap.commandsLog).toHaveLength(3)
    cap.cleanup()
  })

  it('captures a leading read as the initial frame, once per test', async () => {
    const cap = makeCapturer()
    const at = (command: string, timestamp: number) =>
      cap.captureCommand(command, ['#el'], undefined, undefined, { timestamp })
    await at('getText', 1)
    await at('getText', 2)
    await Promise.all(cap.snapshotCaptures)
    expect(cap.actionSnapshots.map((s) => s.timestamp)).toEqual([1])

    cap.resetTestCapture()
    await at('getText', 3)
    await Promise.all(cap.snapshotCaptures)
    expect(cap.actionSnapshots.map((s) => s.timestamp)).toEqual([1, 3])
    cap.cleanup()
  })

  it('retries the initial frame when the first read captures nothing', async () => {
    vi.mocked(coreCapture).mockResolvedValueOnce(null)
    const cap = makeCapturer()
    const at = (command: string, timestamp: number) =>
      cap.captureCommand(command, ['#el'], undefined, undefined, { timestamp })
    await at('getText', 1)
    await Promise.all(cap.snapshotCaptures)
    await at('getText', 2)
    await at('getText', 3)
    await Promise.all(cap.snapshotCaptures)
    expect(cap.actionSnapshots.map((s) => s.timestamp)).toEqual([2])
    cap.cleanup()
  })

  it('does not capture outside trace mode', async () => {
    const cap = new SessionCapturer({}, makeMockBrowser())
    await cap.captureCommand('click', [], undefined, undefined, {
      timestamp: 100
    })
    await Promise.all(cap.snapshotCaptures)
    expect(cap.actionSnapshots).toHaveLength(0)
    cap.cleanup()
  })
})
