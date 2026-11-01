import { describe, expect, it } from 'vitest'
import {
  lineOf,
  commandsForNode
} from '../../src/baseline/command-attribution.js'
import type {
  CommandLogLike,
  TimeWindowNode
} from '../../src/baseline/types.js'

const FILE = '/repo/tests/sample.js'

function node(
  uid: string,
  line: number,
  childUids: string[] = []
): TimeWindowNode {
  return {
    uid,
    kind: 'test',
    file: FILE,
    callSource: `${FILE}:${line}`,
    childUids
  }
}

function cmd(
  command: string,
  callSource: string | undefined,
  timestamp: number
): CommandLogLike {
  return { command, args: [], timestamp, callSource } as CommandLogLike
}

describe('lineOf', () => {
  it('splits file:line and file:line:col', () => {
    expect(lineOf('/a/b.js:13')).toEqual({ file: '/a/b.js', line: 13 })
    expect(lineOf('/a/b.js:13:5')).toEqual({ file: '/a/b.js', line: 13 })
  })
  it('returns undefined for unknown:0-style / missing call sites', () => {
    // `unknown:0` *does* parse (file "unknown", line 0); the carry-forward
    // below is what keeps such commands out of the wrong test.
    expect(lineOf(undefined)).toBeUndefined()
  })
})

describe('commandsForNode — assertion commands inherit the preceding call site', () => {
  // Two tests in one file: navigate (it() @2) and interactions (it() @13).
  // Nightwatch tags every command in the file with the first test's uid and
  // emits assertion commands (title/isVisible) with callSource `unknown:0`.
  const navigate = node('nav', 2)
  const interactions = node('act', 13)
  const nodes = new Map<string, TimeWindowNode>([
    ['nav', navigate],
    ['act', interactions]
  ])

  const commands: CommandLogLike[] = [
    cmd('url', `${FILE}:4`, 100),
    cmd('waitForElementVisible', `${FILE}:5`, 101),
    cmd('title', 'unknown:0', 102), // assertion → navigate
    cmd('isVisible', 'unknown:0', 103), // assertion → navigate
    cmd('getText', `${FILE}:9`, 104),
    cmd('url', `${FILE}:15`, 200),
    cmd('waitForElementVisible', `${FILE}:16`, 201),
    cmd('isVisible', 'unknown:0', 202), // assertion → interactions
    cmd('setValue', `${FILE}:18`, 203),
    cmd('pause', `${FILE}:19`, 204)
  ]

  it('keeps the assertion commands with the test they ran in', () => {
    const nav = commandsForNode(navigate, nodes, commands, {
      start: 100,
      end: 104
    }).map((c) => c.command)
    expect(nav).toEqual([
      'url',
      'waitForElementVisible',
      'title',
      'isVisible',
      'getText'
    ])

    const act = commandsForNode(interactions, nodes, commands, {
      start: 200,
      end: 204
    }).map((c) => c.command)
    expect(act).toEqual([
      'url',
      'waitForElementVisible',
      'isVisible',
      'setValue',
      'pause'
    ])
  })

  it('does not leak the navigate assertions into interactions', () => {
    const act = commandsForNode(interactions, nodes, commands, {
      start: 100, // even with a window that spans both tests
      end: 204
    })
    // only the 5 interaction commands, not navigate's title/isVisible
    expect(act).toHaveLength(5)
    expect(act.some((c) => c.timestamp === 102)).toBe(false)
    expect(act.some((c) => c.timestamp === 103)).toBe(false)
  })
})
