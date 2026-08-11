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
