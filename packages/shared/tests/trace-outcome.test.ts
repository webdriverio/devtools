import { describe, expect, it } from 'vitest'
import { retriedRows } from '../src/command-failure.js'
import {
  commandIndicesIn,
  stepOutcome,
  traceOutcome,
  TRACE_OUTCOME
} from '../src/trace-outcome.js'
import type {
  TraceActionChild,
  TraceActionGroupNode,
  TracePlayerData
} from '../src/trace-player.js'
import { TraceType, type CommandLog } from '../src/types.js'

function playerData(
  commands: CommandLog[],
  groups?: TraceActionChild[]
): TracePlayerData {
  return {
    trace: {
      mutations: [],
      logs: [],
      consoleLogs: [],
      networkRequests: [],
      commands,
      sources: {},
      metadata: { type: TraceType.Testrunner }
    },
    frames: [],
    startTime: 0,
    duration: 0,
    groups
  }
}

const row = (command: string, timestamp: number, extra = {}): CommandLog => ({
  command,
  args: ['#login'],
  timestamp,
  ...extra
})

const failedClick = row('click', 3000, {
  error: { name: 'Error', message: 'not found' }
})

// A passing wait (id 0, as the reader restores it) and the poll it retried past.
const waitWithRetriedPoll = [
  row('waitUntil', 3000, { id: 0, startTime: 2000 }),
  row('isDisplayed', 2100, {
    parentId: 0,
    error: { name: 'Error', message: 'stale element' }
  })
]

function step(
  title: string,
  children: TraceActionChild[],
  failed?: boolean
): TraceActionGroupNode {
  return {
    callId: title,
    title,
    startTime: 0,
    endTime: 1,
    children,
    ...(failed ? { failed } : {})
  }
}

describe('traceOutcome', () => {
  it('reads a trace whose actions all passed as passed', () => {
    expect(traceOutcome(playerData([row('url', 2000)]))).toBe(
      TRACE_OUTCOME.PASSED
    )
  })

  it('reads a trace with a failed action as failed', () => {
    expect(traceOutcome(playerData([row('url', 2000), failedClick]))).toBe(
      TRACE_OUTCOME.FAILED
    )
  })

  it('reads a failed assertion that carries no error as failed', () => {
    const assertion = row('assert.equal', 2000, {
      args: ['a', 'b'],
      result: { passed: false, actual: 'a', expected: 'b' }
    })
    expect(traceOutcome(playerData([assertion]))).toBe(TRACE_OUTCOME.FAILED)
  })

  it('does not count a poll a passing wait retried past', () => {
    expect(traceOutcome(playerData(waitWithRetriedPoll))).toBe(
      TRACE_OUTCOME.PASSED
    )
  })

  it('has no outcome for a trace with no actions', () => {
    expect(traceOutcome(playerData([]))).toBe(TRACE_OUTCOME.UNKNOWN)
  })

  it('reads a step that failed on its own as failed', () => {
    const groups = [
      { group: step('Login', [{ group: step('logs in', [], true) }]) }
    ]
    expect(traceOutcome(playerData([], groups))).toBe(TRACE_OUTCOME.FAILED)
  })
})

describe('stepOutcome', () => {
  const commands = [row('url', 1000), failedClick, ...waitWithRetriedPoll]
  const retried = retriedRows(commands)

  it('reads a step from the rows under it only', () => {
    expect(
      stepOutcome(step('a', [{ commandIndex: 0 }]), commands, retried)
    ).toBe(TRACE_OUTCOME.PASSED)
    expect(
      stepOutcome(
        step('suite', [{ group: step('b', [{ commandIndex: 1 }]) }]),
        commands,
        retried
      )
    ).toBe(TRACE_OUTCOME.FAILED)
  })

  it('reads a wait that retried a poll as passed', () => {
    const wait = { commandIndex: 2, children: [{ commandIndex: 3 }] }
    expect(stepOutcome(step('c', [wait]), commands, retried)).toBe(
      TRACE_OUTCOME.PASSED
    )
  })

  it('reads a step the reader marked failed, or one with no rows', () => {
    expect(stepOutcome(step('d', [], true), commands, retried)).toBe(
      TRACE_OUTCOME.FAILED
    )
    expect(stepOutcome(step('e', []), commands, retried)).toBe(
      TRACE_OUTCOME.UNKNOWN
    )
  })
})

describe('commandIndicesIn', () => {
  it('lists the rows of nested steps and the rows a wait issued', () => {
    const tree: TraceActionChild[] = [
      { group: step('s', [{ commandIndex: 0 }]) },
      { commandIndex: 2, children: [{ commandIndex: 3 }] }
    ]
    expect(commandIndicesIn(tree)).toEqual([0, 2, 3])
  })
})
