import { describe, it, expect, vi } from 'vitest'
import { SessionCapturer } from '../src/session.js'
import type { CommandLog, NightwatchBrowser } from '../src/types.js'

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
    await cap.captureCommand(
      'click',
      ['#btn'],
      undefined,
      undefined,
      undefined,
      undefined,
      7777
    )
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

  it('does not capture outside trace mode', async () => {
    const cap = new SessionCapturer({}, makeMockBrowser())
    await cap.captureCommand(
      'click',
      [],
      undefined,
      undefined,
      undefined,
      undefined,
      100
    )
    await Promise.all(cap.snapshotCaptures)
    expect(cap.actionSnapshots).toHaveLength(0)
    cap.cleanup()
  })
})
