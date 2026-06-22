import { describe, it, expect } from 'vitest'
import { buildActionEvents } from '@wdio/devtools-core'
import type { CommandLog } from '@wdio/devtools-shared'

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

  it('returns empty array for no commands', () => {
    expect(buildActionEvents([], pageId, wallTime)).toEqual([])
  })

  it('returns empty array when no commands map to actions', () => {
    const commands = [cmd('getTitle'), cmd('executeScript')]
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

  it('skips non-action commands but still handles group boundaries', () => {
    const commands = [
      cmd('getTitle', { testUid: 'uid-1' }), // non-action — skipped
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
