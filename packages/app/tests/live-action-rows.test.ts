import { describe, it, expect } from 'vitest'
import type { CommandLog } from '@wdio/devtools-shared'

import {
  activeAncestorIds,
  defaultLiveExpanded,
  liveActionRows,
  liveRowKey,
  type TimelineEntry
} from '../src/components/workbench/live-action-rows.js'

const cmd = (
  command: string,
  timestamp: number,
  extra: Partial<CommandLog> = {}
): CommandLog => ({ command, args: [], timestamp, ...extra })

const load = (timestamp: number) =>
  ({ type: 'childList', url: '/secure', timestamp }) as TraceMutation

const label = (entry: TimelineEntry) =>
  'command' in entry ? entry.command : 'load'

describe('liveActionRows', () => {
  const wait = cmd('waitUntil', 300, { id: 1 })
  const reads = [
    cmd('getText', 120, { id: 2, parentId: 1 }),
    cmd('getText', 110, { id: 3, parentId: 1 })
  ]
  const commands = [cmd('click', 100, { id: 0 }), ...reads, wait]

  it('lists a stream without parentId exactly as the flat timeline did', () => {
    const rows = liveActionRows(
      [load(150), { type: 'attributes', timestamp: 5 } as TraceMutation],
      [cmd('url', 200), cmd('click', 100)],
      () => true
    )
    expect(rows.map((r) => [label(r.entry), r.depth])).toEqual([
      ['click', 0],
      ['load', 0],
      ['url', 0]
    ])
    expect(rows.every((r) => r.key === undefined)).toBe(true)
  })

  it('hides the rows a command issued until it is expanded', () => {
    const rows = liveActionRows([], commands, () => false)
    expect(rows.map((r) => [label(r.entry), r.depth, r.expanded])).toEqual([
      ['click', 0, undefined],
      ['waitUntil', 0, false]
    ])
    expect(rows[1].key).toBe(liveRowKey(wait))
  })

  it('shows them below it, one level in, in time order', () => {
    const rows = liveActionRows([load(115)], commands, () => true)
    expect(rows.map((r) => [label(r.entry), r.depth])).toEqual([
      ['click', 0],
      ['load', 0],
      ['waitUntil', 0],
      ['getText', 1],
      ['getText', 1]
    ])
    expect(rows.slice(3).map((r) => r.entry)).toEqual([reads[1], reads[0]])
  })

  it('keeps a read whose wait has not arrived at the top level', () => {
    const rows = liveActionRows([], reads, () => true)
    expect(rows.map((r) => r.depth)).toEqual([0, 0])
  })
})

describe('defaultLiveExpanded', () => {
  const read = cmd('getText', 20, { id: 2, parentId: 1 })
  const node = (error?: Error) => ({
    command: cmd('waitUntil', 30, { id: 1, ...(error ? { error } : {}) }),
    children: [{ command: read, children: [] }]
  })

  const ancestorsOf = (active?: CommandLog) =>
    activeAncestorIds([node().command, read], active)

  it('opens a failed wait and one holding the active row', () => {
    expect(
      defaultLiveExpanded(node(new Error('timed out')), ancestorsOf())
    ).toBe(true)
    expect(defaultLiveExpanded(node(), ancestorsOf(read))).toBe(true)
  })

  it('keeps a failed wait a passing wait retried past shut', () => {
    const failed = node(new Error('timed out'))
    expect(
      defaultLiveExpanded(failed, ancestorsOf(), new Set([failed.command]))
    ).toBe(false)
  })

  it('keeps a passing wait shut, also while it is itself the active row', () => {
    const passing = node()
    expect(defaultLiveExpanded(passing, ancestorsOf())).toBe(false)
    expect(defaultLiveExpanded(passing, ancestorsOf(passing.command))).toBe(
      false
    )
  })
})

describe('activeAncestorIds', () => {
  const outer = cmd('waitUntil', 50, { id: 1 })
  const inner = cmd('waitUntil', 40, { id: 2, parentId: 1 })
  const read = cmd('getText', 30, { id: 3, parentId: 2 })

  it('walks up from the active row to the top, once', () => {
    expect([...activeAncestorIds([outer, inner, read], read)]).toEqual([2, 1])
  })

  it('stops at a parent that is not in the list, and at a loop', () => {
    expect([...activeAncestorIds([inner, read], read)]).toEqual([2])
    const a = cmd('waitUntil', 10, { id: 7, parentId: 8 })
    const b = cmd('waitUntil', 20, { id: 8, parentId: 7 })
    expect([...activeAncestorIds([a, b], a)]).toEqual([8, 7])
  })
})
