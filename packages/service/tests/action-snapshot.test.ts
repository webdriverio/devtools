import { describe, it, expect, vi } from 'vitest'
import type { ActionSnapshot } from '@wdio/devtools-shared'
import { pushActionSnapshotAt } from '../src/action-snapshot.js'

const mockBrowser = () =>
  ({
    execute: vi.fn().mockResolvedValue([]),
    takeScreenshot: vi.fn().mockResolvedValue('SHOT'),
    getUrl: vi.fn().mockResolvedValue('http://example.com/'),
    getTitle: vi.fn().mockResolvedValue('Example')
  }) as unknown as WebdriverIO.Browser

describe('pushActionSnapshotAt', () => {
  it('captures a DOM snapshot and stamps it at the row timestamp', async () => {
    const snapshots: ActionSnapshot[] = []
    await pushActionSnapshotAt(
      mockBrowser(),
      'expect.toExist',
      12345,
      snapshots
    )
    expect(snapshots).toHaveLength(1)
    // Stamped at the row's own timestamp — not the capture time — so the trace
    // player's FrameSnapshotIndex.claimAfter(cmd.timestamp) matches it.
    expect(snapshots[0]!.timestamp).toBe(12345)
    expect(snapshots[0]!.command).toBe('expect.toExist')
    expect(snapshots[0]!.screenshot).toBe('SHOT')
  })
})

describe('service action-snapshot locator dialect', () => {
  it("injects WebdriverIO's own text form, which resolves in $() directly", async () => {
    // Portable XPath resolves here too, but a WDIO user copying a locator out of
    // the A11y tab expects `a*=Logout`, not something they must wrap.
    const browser = Object.assign(mockBrowser(), {
      options: { framework: 'cucumber' }
    })
    await pushActionSnapshotAt(browser, 'click', 1, [])

    const bodies = vi
      .mocked(browser.execute)
      .mock.calls.map(([fn]) => String(fn))
    expect(bodies).not.toHaveLength(0)
    for (const body of bodies) {
      expect(body).toContain("tag + '*=' + text")
    }
  })
})
