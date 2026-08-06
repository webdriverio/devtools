import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import {
  upsertRichestSnapshot,
  writeTraceZip,
  type TraceCapturer
} from '@wdio/devtools-core'
import { TraceType, type ActionSnapshot } from '@wdio/devtools-shared'

const BLANK = 'AA'
const REAL = 'R'.repeat(200)
const RESULT = 'B'.repeat(400)

function snap(
  timestamp: number,
  screenshot: string,
  overrides: Partial<ActionSnapshot> = {}
): ActionSnapshot {
  return { timestamp, command: 'click', screenshot, ...overrides }
}

describe('upsertRichestSnapshot', () => {
  it("does not let a blank __final__ clobber the last action's real frame", () => {
    const list = [snap(50, REAL), snap(100, REAL)]
    upsertRichestSnapshot(list, {
      timestamp: 100,
      command: '__final__',
      screenshot: BLANK
    })
    expect(list).toHaveLength(2)
    expect(list[1]!.screenshot).toBe(REAL)
  })

  it('upgrades the screenshot when the later capture is richer', () => {
    const list = [snap(50, REAL), snap(100, BLANK)]
    upsertRichestSnapshot(list, {
      timestamp: 100,
      command: '__final__',
      screenshot: RESULT
    })
    expect(list[1]!.screenshot).toBe(RESULT)
  })

  it('keeps the first capture as the action identity', () => {
    // The exporter's collapse keeps first-seen identity, so upsert matches it
    // rather than letting a trailing __final__ rename the action's resource.
    const list = [snap(100, BLANK)]
    upsertRichestSnapshot(list, {
      timestamp: 100,
      command: '__final__',
      screenshot: RESULT
    })
    expect(list[0]!.command).toBe('click')
  })

  it("keeps a poorer capture's elements and snapshotText", () => {
    // The real screenshot and the real element rects can land on different
    // captures of one action; a wholesale replace would drop the latter.
    const list = [
      snap(100, REAL, { elements: [{ selector: '#a' }], snapshotText: 'tree' })
    ]
    upsertRichestSnapshot(list, snap(100, RESULT))
    expect(list[0]!.screenshot).toBe(RESULT)
    expect(list[0]!.elements).toEqual([{ selector: '#a' }])
    expect(list[0]!.snapshotText).toBe('tree')
  })

  it('fills gaps from the later capture', () => {
    const list = [snap(100, RESULT)]
    upsertRichestSnapshot(list, snap(100, BLANK, { snapshotText: 'tree' }))
    expect(list[0]!.snapshotText).toBe('tree')
  })

  it('preserves array length on a timestamp collision', () => {
    // One record per timestamp: a mid-run slice flush reads this array live, so
    // a duplicate would reach the resource writer as a colliding name.
    const list = [snap(100, REAL)]
    upsertRichestSnapshot(list, snap(100, BLANK))
    expect(list).toHaveLength(1)
  })

  it('appends when the timestamp is new', () => {
    const list = [snap(100, REAL)]
    upsertRichestSnapshot(list, snap(200, BLANK))
    expect(list.map((s) => s.timestamp)).toEqual([100, 200])
  })
})

function capturerAt(timestamps: number[]): TraceCapturer {
  return {
    mutations: [],
    traceLogs: [],
    consoleLogs: [],
    networkRequests: [],
    commandsLog: timestamps.map((timestamp) => ({
      command: 'click',
      args: [],
      timestamp,
      startTime: timestamp - 50
    })),
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
}

async function exportWith(snapshots: ActionSnapshot[]) {
  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'snap-bind-'))
  const dir = await writeTraceZip(capturerAt([1200, 1400]), {
    outputDir,
    sessionId: 'sess1234',
    format: 'ndjson-directory',
    actionSnapshots: snapshots
  })
  const trace = await fs.readFile(path.join(dir, 'trace.trace'), 'utf8')
  const events = trace
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Record<string, unknown>)
  const resources = await fs.readdir(path.join(dir, 'resources'))
  return { dir, events, resources, outputDir }
}

describe('snapshot binding contract (capture → export)', () => {
  it('binds a snapshot stamped at the command timestamp', async () => {
    // The triple the A11y tab and the click marker both depend on. This is why
    // every adapter must stamp the command timestamp, not its own capture time.
    const { events, resources, outputDir } = await exportWith([
      snap(1400, RESULT, { snapshotText: 'tree', elements: [{ x: 1 }] })
    ])

    const after = events.find(
      (e) => e.type === 'after' && e.afterSnapshot !== undefined
    )
    expect(after?.afterSnapshot).toBe('after@call@2')

    const frame = events.find((e) => e.type === 'frame-snapshot')
    expect(frame).toBeDefined()
    expect(
      (frame!.snapshot as Record<string, unknown> | undefined)?.wallTime
    ).toBe(1400)

    expect(resources).toContain('page@sess1234-1400-snapshot.txt')

    await fs.rm(outputDir, { recursive: true, force: true })
  })

  it('binds nothing when the snapshot trails the command timestamp', async () => {
    // The pre-fix Selenium/Nightwatch shape: the capture resolves after the
    // command, so its own Date.now() misses every claim.
    const { events, outputDir } = await exportWith([
      snap(1440, RESULT, { snapshotText: 'tree' })
    ])

    expect(
      events.some((e) => e.type === 'after' && e.afterSnapshot !== undefined)
    ).toBe(false)
    expect(events.some((e) => e.type === 'frame-snapshot')).toBe(false)

    await fs.rm(outputDir, { recursive: true, force: true })
  })

  it("exports the last action's real result, not the blank __final__ frame", async () => {
    const snapshots = [snap(1200, REAL), snap(1400, RESULT)]
    upsertRichestSnapshot(snapshots, {
      timestamp: 1400,
      command: '__final__',
      screenshot: BLANK
    })
    const { dir, outputDir } = await exportWith(snapshots)

    const frame = await fs.readFile(
      path.join(dir, 'resources', 'page@sess1234-1400.jpeg')
    )
    expect(frame.toString('base64')).toBe(RESULT)

    await fs.rm(outputDir, { recursive: true, force: true })
  })
})
