import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import {
  buildActionEvents,
  writeTraceZip,
  FrameSnapshotIndex,
  type TraceCapturer
} from '@wdio/devtools-core'
import { TraceType, type CommandLog } from '@wdio/devtools-shared'

function cmd(command: string, overrides: Partial<CommandLog> = {}): CommandLog {
  const base = (overrides.timestamp ?? 1000) + 100
  return {
    command,
    args: [],
    timestamp: base,
    startTime: overrides.startTime ?? base - 50,
    ...overrides
  }
}

describe('buildActionEvents', () => {
  const pageId = 'page@abc123'
  const wallTime = 1000

  it('stamps a stack frame from the captured callSource', () => {
    const commands = [
      cmd('click', { callSource: '/specs/login.ts:42' }),
      cmd('url', { timestamp: 1400, startTime: 1350 })
    ]
    const befores = buildActionEvents(commands, pageId, wallTime).filter(
      (e) => e.type === 'before'
    )
    expect(befores[0]!.stack).toEqual([
      { file: '/specs/login.ts', line: 42, column: 0 }
    ])
    expect(befores[1]!.stack).toBeUndefined()
  })

  it('stamps the command result on the after event', () => {
    const commands = [cmd('execute', { result: 'flash text' })]
    const after = buildActionEvents(commands, pageId, wallTime).find(
      (e) => e.type === 'after'
    )!
    expect(after.result).toBe('flash text')
  })

  it('drops oversized command results from the after event', () => {
    const commands = [cmd('execute', { result: 'x'.repeat(70 * 1024) })]
    const after = buildActionEvents(commands, pageId, wallTime).find(
      (e) => e.type === 'after'
    )!
    expect(after.result).toBeUndefined()
  })

  it('returns empty array for no commands', () => {
    expect(buildActionEvents([], pageId, wallTime)).toEqual([])
  })

  it('returns empty array when no commands map to actions', () => {
    const commands = [cmd('clearValue'), cmd('executeScript')]
    expect(buildActionEvents(commands, pageId, wallTime)).toEqual([])
  })

  it('produces before/after pairs for a single actionable command', () => {
    const commands = [cmd('url', { timestamp: 1200, startTime: 1150 })]
    const events = buildActionEvents(commands, pageId, wallTime)

    const befores = events.filter((e) => e.type === 'before')
    const afters = events.filter((e) => e.type === 'after')

    expect(befores).toHaveLength(1)
    expect(afters).toHaveLength(1)
    expect(befores[0]!.callId).toBe('call@1')
    expect(afters[0]!.callId).toBe('call@1')
    expect(befores[0]!.apiName).toBe('page.navigate')
  })

  it('assigns sequential callIds across commands', () => {
    const commands = [
      cmd('url', { timestamp: 1200, startTime: 1150 }),
      cmd('click', { timestamp: 1400, startTime: 1350 })
    ]
    const events = buildActionEvents(commands, pageId, wallTime)

    const befores = events.filter((e) => e.type === 'before')
    expect(befores[0]!.callId).toBe('call@1')
    expect(befores[1]!.callId).toBe('call@2')
  })

  it('sets endTime >= startTime + 1ms for minimum duration', () => {
    // If start and end are too close, end is clamped to start + 1
    const commands = [cmd('url', { timestamp: 1001, startTime: 1000 })]
    const events = buildActionEvents(commands, pageId, wallTime)

    const before = events.find((e) => e.type === 'before')!
    const after = events.find((e) => e.type === 'after')!
    expect(after.endTime).toBeGreaterThanOrEqual(before.startTime + 1)
  })

  it('floors startTime at prevEndMs to prevent overlap', () => {
    // Second command starts before first ends in wall-time terms
    const commands = [
      cmd('url', { timestamp: 1200, startTime: 1150 }),
      cmd('click', { timestamp: 1250, startTime: 1190 })
    ]
    const events = buildActionEvents(commands, pageId, wallTime)

    const befores = events.filter((e) => e.type === 'before')
    // Second before should be >= first after's endTime
    const firstAfter = events.find(
      (e) => e.type === 'after' && e.callId === 'call@1'
    )!
    expect(befores[1]!.startTime).toBeGreaterThanOrEqual(firstAfter.endTime)
  })

  it('flags errors on after events', () => {
    const commands = [
      cmd('click', { error: { name: 'Error', message: 'no such element' } })
    ]
    const events = buildActionEvents(commands, pageId, wallTime)

    const after = events.find((e) => e.type === 'after')!
    expect(after.error).toEqual({ message: 'no such element' })
  })
})

describe('buildActionEvents — tracingGroup (testUid boundaries)', () => {
  const pageId = 'page@abc123'
  const wallTime = 1000

  const testMeta = new Map([
    ['uid-1', { title: 'test A', specFile: '/specs/a.js' }],
    ['uid-2', { title: 'test B', specFile: '/specs/a.js' }]
  ])

  it('does NOT emit tracingGroup when no command has testUid', () => {
    const commands = [cmd('url'), cmd('click')]
    const events = buildActionEvents(commands, pageId, wallTime)
    const groups = events.filter(
      (e) =>
        e.type === 'before' &&
        'method' in e &&
        (e as { method: string }).method === 'tracingGroup'
    )
    expect(groups).toHaveLength(0)
  })

  it('emits tracingGroup open/close when testUid appears on first command', () => {
    const commands = [cmd('url', { testUid: 'uid-1' })]
    const events = buildActionEvents(commands, pageId, wallTime, testMeta)

    const groupBefore = events.find(
      (e) =>
        e.type === 'before' &&
        'method' in e &&
        (e as { method: string }).method === 'tracingGroup'
    )!
    const groupAfter = events.find(
      (e) => e.type === 'after' && e.callId === groupBefore.callId
    )!

    expect(groupBefore.apiName).toBe('tracing.tracingGroup')
    expect(groupBefore.params).toEqual({ name: 'test A' })
    expect(groupBefore.class).toBe('Tracing')
    expect(groupBefore.title).toBe('test A')
    expect(groupAfter).toBeDefined()
  })

  it('links child actions to the group via parentId', () => {
    const commands = [
      cmd('url', { testUid: 'uid-1', timestamp: 1200, startTime: 1150 })
    ]
    const events = buildActionEvents(commands, pageId, wallTime, testMeta)

    const groupBefore = events.find(
      (e) =>
        e.type === 'before' &&
        'method' in e &&
        (e as { method: string }).method === 'tracingGroup'
    )!
    const actionBefore = events.find(
      (e) => e.type === 'before' && e.callId !== groupBefore.callId
    )!

    expect(actionBefore!.parentId).toBe(groupBefore.callId)
  })

  it('closes the previous group and opens a new one when testUid changes', () => {
    const commands = [
      cmd('url', { testUid: 'uid-1', timestamp: 1200, startTime: 1150 }),
      cmd('click', { testUid: 'uid-2', timestamp: 1500, startTime: 1450 })
    ]
    const events = buildActionEvents(commands, pageId, wallTime, testMeta)

    const groups = events.filter(
      (e) =>
        e.type === 'before' &&
        'method' in e &&
        (e as { method: string }).method === 'tracingGroup'
    )
    expect(groups).toHaveLength(2)

    // First group: uid-1 → "test A"
    expect(groups[0]!.params).toEqual({ name: 'test A' })
    // Second group: uid-2 → "test B"
    expect(groups[1]!.params).toEqual({ name: 'test B' })

    // First group's after should close before the second group's before
    const groupAfters = events.filter(
      (e) =>
        e.type === 'after' &&
        'method' in e === false &&
        (groups as { callId: string }[]).some((g) => g.callId === e.callId)
    )
    expect(groupAfters).toHaveLength(2)
  })

  it('uses raw testUid as fallback name when testMetadata is missing', () => {
    const commands = [cmd('url', { testUid: 'unknown-uid' })]
    const events = buildActionEvents(commands, pageId, wallTime)

    const groupBefore = events.find(
      (e) =>
        e.type === 'before' &&
        'method' in e &&
        (e as { method: string }).method === 'tracingGroup'
    )!
    expect(groupBefore.params).toEqual({ name: 'unknown-uid' })
  })

  it('does not stamp snapshot refs on tracingGroup events', () => {
    const commands = [
      cmd('url', { testUid: 'uid-1', timestamp: 1200, startTime: 1150 }),
      cmd('click', { testUid: 'uid-2', timestamp: 1400, startTime: 1350 })
    ]
    const index = new FrameSnapshotIndex([
      { timestamp: 1200, command: 'url', screenshot: 'AAAA' },
      { timestamp: 1400, command: 'click', screenshot: 'BBBB' }
    ])
    const events = buildActionEvents(
      commands,
      pageId,
      wallTime,
      testMeta,
      index
    )
    const groups = events.filter(
      (e) => e.type === 'before' && e.method === 'tracingGroup'
    )
    for (const group of groups) {
      expect(group).not.toHaveProperty('beforeSnapshot')
      const groupAfter = events.find(
        (e) => e.type === 'after' && e.callId === group.callId
      )!
      expect(groupAfter.afterSnapshot).toBeUndefined()
    }
  })

  it('skips non-action commands but still handles group boundaries', () => {
    const commands = [
      cmd('clearValue', { testUid: 'uid-1' }), // non-action — skipped
      cmd('url', { testUid: 'uid-2', timestamp: 1200, startTime: 1150 })
    ]
    const events = buildActionEvents(commands, pageId, wallTime, testMeta)

    // Only one tracingGroup (uid-2 starts with the first action)
    const groups = events.filter(
      (e) =>
        e.type === 'before' &&
        'method' in e &&
        (e as { method: string }).method === 'tracingGroup'
    )
    expect(groups).toHaveLength(1)
    expect(groups[0]!.params).toEqual({ name: 'test B' })
  })
})

describe('buildActionEvents — frame-snapshot refs', () => {
  const pageId = 'page@abc123'
  const wallTime = 1000

  it('stamps afterSnapshot when a screenshot matches the command timestamp', () => {
    const commands = [cmd('url', { timestamp: 1200, startTime: 1150 })]
    const index = new FrameSnapshotIndex([
      { timestamp: 1200, command: 'url', screenshot: 'AAAA' }
    ])
    const events = buildActionEvents(
      commands,
      pageId,
      wallTime,
      undefined,
      index
    )
    const after = events.find((e) => e.type === 'after')!
    expect(after.afterSnapshot).toBe('after@call@1')
    expect(index.refs()).toHaveLength(1)
  })

  it('uses the previous action snapshot as the next action before ref', () => {
    const commands = [
      cmd('url', { timestamp: 1200, startTime: 1150 }),
      cmd('click', { timestamp: 1400, startTime: 1350 })
    ]
    const index = new FrameSnapshotIndex([
      { timestamp: 1200, command: 'url', screenshot: 'AAAA' },
      { timestamp: 1400, command: 'click', screenshot: 'BBBB' }
    ])
    const events = buildActionEvents(
      commands,
      pageId,
      wallTime,
      undefined,
      index
    )
    const befores = events.filter((e) => e.type === 'before')
    expect(befores[0]!.beforeSnapshot).toBeUndefined()
    expect(befores[1]!.beforeSnapshot).toBe('after@call@1')
    const afters = events.filter((e) => e.type === 'after')
    expect(afters[1]!.afterSnapshot).toBe('after@call@2')
  })

  it('leaves refs unset for commands without matching screenshots', () => {
    const commands = [cmd('url', { timestamp: 1200, startTime: 1150 })]
    const index = new FrameSnapshotIndex([])
    const events = buildActionEvents(
      commands,
      pageId,
      wallTime,
      undefined,
      index
    )
    expect(
      events.find((e) => e.type === 'before')!.beforeSnapshot
    ).toBeUndefined()
    expect(
      events.find((e) => e.type === 'after')!.afterSnapshot
    ).toBeUndefined()
  })
})

describe('exported trace stream — frame-snapshot events', () => {
  it('emits an image frame-snapshot sorted after its action', async () => {
    const outputDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'trace-frame-snapshots-')
    )
    const capturer: TraceCapturer = {
      mutations: [],
      traceLogs: [],
      consoleLogs: [],
      networkRequests: [],
      commandsLog: [
        {
          command: 'url',
          args: ['https://example.test'],
          timestamp: 1200,
          startTime: 1150,
          screenshot: 'AAAA'
        }
      ],
      sources: new Map(),
      metadata: {
        type: TraceType.Standalone,
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
    const dir = await writeTraceZip(capturer, {
      outputDir,
      sessionId: 'abc12345',
      format: 'ndjson-directory'
    })
    const raw = await fs.readFile(path.join(dir, 'trace.trace'), 'utf8')
    const lines = raw
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as Record<string, unknown>)

    const afterIdx = lines.findIndex((l) => l.type === 'after')
    const snapIdx = lines.findIndex((l) => l.type === 'frame-snapshot')
    expect(afterIdx).toBeGreaterThan(-1)
    expect(snapIdx).toBeGreaterThan(afterIdx)

    const after = lines[afterIdx] as { afterSnapshot?: string }
    expect(after.afterSnapshot).toBe('after@call@1')

    const snapshot = (lines[snapIdx] as { snapshot: Record<string, unknown> })
      .snapshot
    expect(snapshot.snapshotName).toBe('after@call@1')
    expect(snapshot.callId).toBe('call@1')
    expect(snapshot.pageId).toBe('page@abc12345')
    expect(snapshot.frameId).toBe('frame@abc12345')
    expect(snapshot.isMainFrame).toBe(true)
    expect(snapshot.timestamp).toBe(200)
    expect(snapshot.viewport).toEqual({ width: 800, height: 600 })
    await fs.rm(outputDir, { recursive: true, force: true })
  })
})
