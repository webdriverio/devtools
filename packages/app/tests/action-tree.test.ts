import { describe, it, expect } from 'vitest'
import type {
  TraceActionChild,
  TraceActionGroupNode
} from '@wdio/devtools-shared'

import {
  collectCommandIndices,
  defaultExpanded,
  flattenActionTree
} from '../src/components/workbench/action-tree.js'

function group(
  callId: string,
  children: TraceActionChild[],
  failed = false
): TraceActionGroupNode {
  return {
    callId,
    title: callId,
    startTime: 0,
    endTime: 10,
    children,
    ...(failed ? { failed } : {})
  }
}

const NESTED = group('hook', [
  { group: group('fixture', [{ commandIndex: 0 }, { commandIndex: 1 }]) },
  { commandIndex: 2 }
])

describe('collectCommandIndices', () => {
  it('gathers indices across nested groups', () => {
    expect(collectCommandIndices(NESTED)).toEqual([0, 1, 2])
  })

  it('is empty for a group with no command descendants', () => {
    expect(collectCommandIndices(group('empty', []))).toEqual([])
  })
})

describe('defaultExpanded', () => {
  it('opens failed groups', () => {
    expect(defaultExpanded(group('g', [], true))).toBe(true)
  })

  it('opens the group holding the active command', () => {
    expect(defaultExpanded(NESTED, 1)).toBe(true)
  })

  it('keeps other groups collapsed', () => {
    expect(defaultExpanded(NESTED, 7)).toBe(false)
    expect(defaultExpanded(NESTED)).toBe(false)
  })
})

describe('flattenActionTree', () => {
  const root: TraceActionChild[] = [{ group: NESTED }, { commandIndex: 3 }]

  it('hides children of collapsed groups', () => {
    const rows = flattenActionTree(root, () => false)
    expect(rows).toEqual([
      { kind: 'group', group: NESTED, depth: 0, expanded: false },
      { kind: 'command', commandIndex: 3, depth: 0 }
    ])
  })

  it('descends into expanded groups with increasing depth', () => {
    const rows = flattenActionTree(root, () => true)
    expect(
      rows.map((row) =>
        row.kind === 'group'
          ? [row.group.callId, row.depth]
          : [row.commandIndex, row.depth]
      )
    ).toEqual([
      ['hook', 0],
      ['fixture', 1],
      [0, 2],
      [1, 2],
      [2, 1],
      [3, 0]
    ])
  })

  it('expands only the groups the predicate opens', () => {
    const rows = flattenActionTree(root, (g) => g.callId === 'hook')
    expect(
      rows.map((row) =>
        row.kind === 'group' ? row.group.callId : row.commandIndex
      )
    ).toEqual(['hook', 'fixture', 2, 3])
  })
})
