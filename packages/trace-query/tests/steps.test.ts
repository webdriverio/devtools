import { describe, expect, it } from 'vitest'
import {
  TraceType,
  type CommandLog,
  type TraceActionChild,
  type TraceActionGroupNode,
  type TracePlayerData
} from '@wdio/devtools-shared'
import { collectErrors } from '../src/errors.js'
import {
  failedBranches,
  stepsFailedOnTheirOwn,
  treeWithin
} from '../src/steps.js'
import type { TestNode } from '../src/types.js'

const node = (
  title: string,
  outcome: TestNode['outcome'],
  children?: TestNode[]
): TestNode => ({
  callId: title,
  title,
  outcome,
  ...(children ? { children } : {})
})

const TREE: TestNode[] = [
  node('suite', 'failed', [
    node('passes', 'passed'),
    node('fails', 'failed', [
      node('step ok', 'passed'),
      node('step bad', 'failed')
    ]),
    node('empty', 'unknown')
  ]),
  node('other suite', 'passed', [node('a', 'passed'), node('b', 'passed')])
]

describe('failedBranches', () => {
  it('keeps the failed branches and counts every node it leaves out', () => {
    expect(failedBranches(TREE)).toEqual({
      kept: [
        node('suite', 'failed', [
          node('fails', 'failed', [node('step bad', 'failed')])
        ])
      ],
      omitted: 6
    })
  })
})

describe('treeWithin', () => {
  it('keeps the whole tree when it fits', () => {
    expect(treeWithin(TREE, 10_000)).toEqual({ kept: TREE, omitted: 0 })
  })

  it('keeps nodes in order until the budget, serializing within it', () => {
    for (const budget of [60, 150, 300]) {
      const { kept, omitted } = treeWithin(TREE, budget)
      expect(JSON.stringify(kept).length).toBeLessThanOrEqual(budget)
      const count = (nodes: TestNode[]): number =>
        nodes.reduce((total, n) => total + 1 + count(n.children ?? []), 0)
      expect(count(kept) + omitted).toBe(count(TREE))
    }
    expect(treeWithin(TREE, 150).kept[0]?.title).toBe('suite')
  })
})

function step(
  callId: string,
  children: TraceActionChild[],
  error?: string
): TraceActionGroupNode {
  return {
    callId,
    title: callId,
    startTime: 1_000,
    endTime: 2_000,
    children,
    ...(error ? { failed: true, error } : {})
  }
}

function playerData(
  groups: TraceActionChild[],
  commands: CommandLog[] = [{ command: 'click', args: [], timestamp: 1_500 }]
): TracePlayerData {
  return {
    trace: {
      mutations: [],
      logs: [],
      consoleLogs: [],
      networkRequests: [],
      commands,
      sources: {},
      metadata: { type: TraceType.Standalone }
    },
    frames: [],
    startTime: 1_000,
    duration: 1_000,
    groups
  }
}

describe('stepsFailedOnTheirOwn', () => {
  it('lists only the innermost of nested steps carrying one error, once', () => {
    const data = playerData([
      {
        group: step(
          'wrapper',
          [{ group: step('hook', [{ commandIndex: 0 }], 'hook failed') }],
          'hook failed'
        )
      }
    ])
    expect(stepsFailedOnTheirOwn(data, new Set()).map((s) => s.callId)).toEqual(
      ['hook']
    )
    expect(collectErrors(data)).toEqual([
      expect.objectContaining({ kind: 'step', callId: 'hook' })
    ])
  })

  it('leaves out a step whose failed row explains its error', () => {
    const failed: CommandLog = {
      command: 'click',
      args: [],
      timestamp: 1_500,
      error: { name: 'Error', message: 'not found' }
    }
    const data = playerData(
      [{ group: step('test', [{ commandIndex: 0 }], 'not found') }],
      [failed]
    )
    expect(stepsFailedOnTheirOwn(data, new Set())).toEqual([])
  })
})
