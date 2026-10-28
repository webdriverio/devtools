import { describe, it, expect } from 'vitest'
import type {
  CommandLog,
  TraceActionChild,
  TraceActionGroupNode
} from '@wdio/devtools-shared'

import {
  collectCommandIndices,
  defaultCommandExpanded,
  defaultExpanded,
  flattenActionTree,
  nodeKey,
  rowKey
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
    const rows = flattenActionTree(
      root,
      (node) => 'group' in node && node.group.callId === 'hook'
    )
    expect(
      rows.map((row) =>
        row.kind === 'group' ? row.group.callId : row.commandIndex
      )
    ).toEqual(['hook', 'fixture', 2, 3])
  })
})

describe('rowKey', () => {
  it('keys a group row on its callId', () => {
    expect(
      rowKey({ kind: 'group', group: NESTED, depth: 0, expanded: true })
    ).toBe('group:hook')
  })

  it('keys a command row on its command index', () => {
    expect(rowKey({ kind: 'command', commandIndex: 2, depth: 1 })).toBe(
      'command:2'
    )
  })

  it('separates a numeric callId from the command index it reads as', () => {
    const numeric = rowKey({
      kind: 'group',
      group: group('2', []),
      depth: 0,
      expanded: false
    })

    expect(numeric).not.toBe(
      rowKey({ kind: 'command', commandIndex: 2, depth: 0 })
    )
  })
})

// A wait (command 0) that issued two reads (1, 2), inside a group.
const WAIT = {
  commandIndex: 0,
  children: [{ commandIndex: 1 }, { commandIndex: 2 }]
}
const WITH_WAIT = group('test', [WAIT, { commandIndex: 3 }])
const commands = (failedIndex?: number): CommandLog[] =>
  [0, 1, 2, 3].map((i) => ({
    command: 'c',
    args: [],
    timestamp: i,
    ...(i === failedIndex ? { error: new Error('timed out') } : {})
  }))

describe('a command that issued others', () => {
  it('counts its rows among the commands its group holds', () => {
    expect(collectCommandIndices(WITH_WAIT)).toEqual([0, 1, 2, 3])
    expect(defaultExpanded(WITH_WAIT, 2)).toBe(true)
  })

  it('opens by default when it failed or holds the active command, and stays shut otherwise', () => {
    expect(defaultCommandExpanded(WAIT, commands(0))).toBe(true)
    expect(defaultCommandExpanded(WAIT, commands(), 2)).toBe(true)
    expect(defaultCommandExpanded(WAIT, commands(), 0)).toBe(false)
    expect(defaultCommandExpanded(WAIT, commands(3), 3)).toBe(false)
  })

  it('renders as a command row that reports whether its rows are shown', () => {
    const shut = flattenActionTree(
      [{ group: WITH_WAIT }],
      (node) => 'group' in node
    )
    expect(shut).toEqual([
      { kind: 'group', group: WITH_WAIT, depth: 0, expanded: true },
      { kind: 'command', commandIndex: 0, depth: 1, expanded: false },
      { kind: 'command', commandIndex: 3, depth: 1 }
    ])
    const open = flattenActionTree([{ group: WITH_WAIT }], () => true)
    expect(
      open.map((row) => row.kind === 'command' && [row.commandIndex, row.depth])
    ).toEqual([false, [0, 1], [1, 2], [2, 2], [3, 1]])
  })

  it('keys a command node the way its row is keyed', () => {
    expect(nodeKey(WAIT)).toBe(
      rowKey({ kind: 'command', commandIndex: 0, depth: 0 })
    )
    expect(nodeKey({ group: NESTED })).toBe('group:hook')
  })
})
