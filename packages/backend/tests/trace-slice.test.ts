/**
 * Splitting an accumulated run into per-test slices.
 *
 * Commands are attributed by `testUid`; every other stream is bounded by the
 * test's own window. The cases that matter are the ones where those two
 * disagree, and the ones where a window is unusable.
 */

import { describe, it, expect } from 'vitest'
import { sliceRunByTest } from '../src/trace-slice.js'
import { freshRun } from '../src/baseline/utils.js'
import type { ActiveRun, TimeWindowNode } from '../src/baseline/types.js'

function node(o: Partial<TimeWindowNode> = {}): TimeWindowNode {
  return { uid: 't1', kind: 'test', childUids: [], start: 100, end: 200, ...o }
}

function run(o: Partial<ActiveRun> = {}): ActiveRun {
  return { ...freshRun(), ...o }
}

const twoTests = new Map([
  ['t1', node({ uid: 't1', title: 'first', start: 100, end: 200 })],
  ['t2', node({ uid: 't2', title: 'second', start: 200, end: 300 })]
])

describe('sliceRunByTest', () => {
  it('gives each test its own commands, by uid rather than by clock', () => {
    // The uid is what the adapter stamped; trusting it beats re-deriving
    // attribution from timestamps that can tie at a boundary.
    const sliced = sliceRunByTest(
      run({
        nodes: twoTests,
        commands: [
          { command: 'a', args: [], timestamp: 150, testUid: 't1' },
          { command: 'b', args: [], timestamp: 250, testUid: 't2' },
          { command: 'c', args: [], timestamp: 150, testUid: 't2' }
        ]
      })
    )

    expect(sliced.map((s) => s.uid)).toEqual(['t1', 't2'])
    expect(sliced[0]!.run.commands.map((c) => c.command)).toEqual(['a'])
    // `c` is timestamped inside t1's window but belongs to t2.
    expect(sliced[1]!.run.commands.map((c) => c.command)).toEqual(['b', 'c'])
  })

  it('drops a command no test claimed', () => {
    const sliced = sliceRunByTest(
      run({
        nodes: twoTests,
        commands: [{ command: 'orphan', args: [], timestamp: 150 }]
      })
    )

    expect(sliced.every((s) => s.run.commands.length === 0)).toBe(true)
  })

  it('bounds the timestamped streams by the test window, inclusively', () => {
    const sliced = sliceRunByTest(
      run({
        nodes: twoTests,
        consoleLogs: [
          { type: 'log', args: [], timestamp: 100, source: 'browser' },
          { type: 'log', args: [], timestamp: 201, source: 'browser' }
        ],
        mutations: [{ timestamp: 200 } as never, { timestamp: 99 } as never]
      })
    )

    // A row stamped exactly on a boundary belongs to that test.
    expect(sliced[0]!.run.consoleLogs.map((c) => c.timestamp)).toEqual([100])
    expect(sliced[0]!.run.mutations).toHaveLength(1)
  })

  it('skips a test with no usable window rather than giving it the whole run', () => {
    const sliced = sliceRunByTest(
      run({
        nodes: new Map([
          ['t1', node({ uid: 't1', start: undefined })],
          ['t2', node({ uid: 't2', end: undefined })],
          ['t3', node({ uid: 't3', start: 300, end: 200 })]
        ]),
        commands: [{ command: 'a', args: [], timestamp: 1, testUid: 't1' }]
      })
    )

    expect(sliced).toEqual([])
  })

  it('ignores suites', () => {
    const sliced = sliceRunByTest(
      run({
        nodes: new Map([
          ['s1', node({ uid: 's1', kind: 'suite' })],
          ['t1', node({ uid: 't1' })]
        ])
      })
    )

    expect(sliced.map((s) => s.uid)).toEqual(['t1'])
  })

  it('carries one node so the slice opens one group, not the run’s', () => {
    const sliced = sliceRunByTest(run({ nodes: twoTests }))

    expect([...sliced[0]!.run.nodes.keys()]).toEqual(['t1'])
  })

  it('shares sources rather than slicing them', () => {
    // The Source tab needs the file a command points at; a run's sources are
    // small next to its frames.
    const sources = { '/a.py': 'print(1)' }
    const sliced = sliceRunByTest(run({ nodes: twoTests, sources }))

    expect(sliced[0]!.run.sources).toEqual(sources)
  })
})
