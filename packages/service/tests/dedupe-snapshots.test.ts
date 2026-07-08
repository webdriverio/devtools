import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { writeTraceZip, type TraceCapturer } from '@wdio/devtools-core'
import { TraceType, type ActionSnapshot } from '@wdio/devtools-shared'
import {
  dedupeSnapshotsByTimestamp,
  upsertRichestSnapshot
} from '../src/snapshot-dedupe.js'

function snap(timestamp: number, screenshot: string): ActionSnapshot {
  return { timestamp, command: 'click', screenshot }
}

describe('dedupeSnapshotsByTimestamp', () => {
  it('keeps the largest screenshot when timestamps collide', () => {
    // A navigated action's content result and the blank pre/final captures all
    // land on the same timestamp; the richest (content) frame must win.
    const blank = 'AA'
    const content = 'A'.repeat(100)
    const result = dedupeSnapshotsByTimestamp([
      snap(100, content),
      snap(100, blank),
      snap(100, blank)
    ])
    expect(result).toHaveLength(1)
    expect(result[0].screenshot).toBe(content)
  })

  it('keeps distinct timestamps and returns them sorted', () => {
    const result = dedupeSnapshotsByTimestamp([
      snap(300, 'c'),
      snap(100, 'a'),
      snap(200, 'b')
    ])
    expect(result.map((s) => s.timestamp)).toEqual([100, 200, 300])
  })

  it('handles an empty list', () => {
    expect(dedupeSnapshotsByTimestamp([])).toEqual([])
  })
})

describe('upsertRichestSnapshot', () => {
  const blank = 'AA'
  const content = 'A'.repeat(100)

  it("does not let a blank __final__ clobber the last action's real frame", () => {
    // The last action's post-capture (real) and the end-of-scenario __final__
    // (blank) share the last action's timestamp; the real frame must survive.
    const list: ActionSnapshot[] = [snap(50, content), snap(100, content)]
    const final: ActionSnapshot = {
      timestamp: 100,
      command: '__final__',
      screenshot: blank
    }
    upsertRichestSnapshot(list, final)
    expect(list).toHaveLength(2)
    expect(list[1].screenshot).toBe(content)
    expect(list[1].command).toBe('click')
  })

  it('replaces in place when the final capture is richer', () => {
    // Mirror the opposite case: the action was screenshotted mid-navigation
    // (blank) and the settled __final__ is the real frame.
    const list: ActionSnapshot[] = [snap(50, content), snap(100, blank)]
    const final: ActionSnapshot = {
      timestamp: 100,
      command: '__final__',
      screenshot: content
    }
    upsertRichestSnapshot(list, final)
    expect(list).toHaveLength(2)
    expect(list[1].screenshot).toBe(content)
    expect(list[1].command).toBe('__final__')
  })

  it('preserves array length/indices on a timestamp collision', () => {
    // Spec-range slicing indexes into this array, so a collision must never
    // change its length — only replace in place or skip.
    const list: ActionSnapshot[] = [snap(100, content)]
    upsertRichestSnapshot(list, snap(100, blank))
    expect(list).toHaveLength(1)
  })

  it('appends when the timestamp is new', () => {
    const list: ActionSnapshot[] = [snap(100, content)]
    upsertRichestSnapshot(list, snap(200, blank))
    expect(list.map((s) => s.timestamp)).toEqual([100, 200])
  })
})

describe('final-frame regression (capture → export)', () => {
  it("exports the last action's real result, not the blank __final__ frame", async () => {
    // Base64 payloads chosen so byte-length ranks blank < real < result and
    // each round-trips cleanly through the resource writer's base64 decode.
    const blank = 'AA'
    const real = 'R'.repeat(200)
    const result = 'B'.repeat(400)

    // The service builds pre/post captures per action; the last action's
    // post-capture (result) collides on timestamp with the trailing __final__.
    const snapshots: ActionSnapshot[] = [
      { timestamp: 1200, command: 'url', screenshot: real },
      { timestamp: 1200, command: 'click', screenshot: real },
      { timestamp: 1400, command: 'click', screenshot: result }
    ]
    upsertRichestSnapshot(snapshots, {
      timestamp: 1400,
      command: '__final__',
      screenshot: blank
    })
    const prepared = dedupeSnapshotsByTimestamp(snapshots)

    const capturer: TraceCapturer = {
      mutations: [],
      traceLogs: [],
      consoleLogs: [],
      networkRequests: [],
      commandsLog: [
        { command: 'url', args: [], timestamp: 1200, startTime: 1150 },
        { command: 'click', args: [], timestamp: 1400, startTime: 1350 }
      ],
      sources: new Map(),
      metadata: {
        type: TraceType.Testrunner,
        viewport: {
          width: 800,
          height: 600,
          offsetLeft: 0,
          offsetTop: 0,
          scale: 1
        }
      },
      startWallTime: 1000
    }

    const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'final-frame-'))
    const dir = await writeTraceZip(capturer, {
      outputDir,
      sessionId: 'sess1234',
      format: 'ndjson-directory',
      actionSnapshots: prepared
    })

    const frame = await fs.readFile(
      path.join(dir, 'resources', 'page@sess1234-1400.jpeg')
    )
    // The last action's frame is the real result, never the blank capture.
    expect(frame.toString('base64')).toBe(result)
    expect(frame.length).not.toBe(Buffer.from(blank, 'base64').length)

    await fs.rm(outputDir, { recursive: true, force: true })
  })
})
