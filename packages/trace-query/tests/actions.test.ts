import { describe, expect, it } from 'vitest'
import {
  TraceType,
  type CommandLog,
  type TracePlayerData
} from '@wdio/devtools-shared'
import {
  actionByCallId,
  actionId,
  actionStatus,
  orderedActions
} from '../src/actions.js'

function playerData(commands: CommandLog[]): TracePlayerData {
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
    duration: 0
  }
}

const row = (callId: string, extra: Partial<CommandLog> = {}): CommandLog => ({
  command: 'click',
  args: [],
  timestamp: 2_000,
  callId,
  ...extra
})

describe('orderedActions', () => {
  it('orders by start time, then position', () => {
    const data = playerData([
      row('late', { startTime: 1_500 }),
      row('tie-a', { startTime: 1_300 }),
      row('no-start', { timestamp: 1_100 }),
      row('tie-b', { startTime: 1_300 })
    ])
    expect(orderedActions(data).map((action) => action.callId)).toEqual([
      'no-start',
      'tie-a',
      'tie-b',
      'late'
    ])
  })

  it('times each action in ms from the trace start, keeping its position', () => {
    const [action] = orderedActions(
      playerData([row('a', { startTime: 1_200.4, timestamp: 1_450.6 })])
    )
    expect(action).toMatchObject({ index: 0, startMs: 200, endMs: 451 })
  })
})

describe('actionByCallId', () => {
  const data = playerData([row('call@3'), row('call@4')])

  it('finds the row a callId names', () => {
    expect(actionByCallId(data, 'call@4')).toMatchObject({
      command: data.trace.commands[1],
      index: 1,
      callId: 'call@4'
    })
  })

  it('refuses a callId the trace does not hold', () => {
    expect(() => actionByCallId(data, 'call@9')).toThrow(
      'The trace has no action "call@9": pass a callId from the action list'
    )
  })

  it('names a row without a callId by its position', () => {
    const anonymous = { command: 'click', args: [], timestamp: 2_000 }
    const withGap = playerData([row('call@1'), anonymous])
    expect(actionId(anonymous, 1)).toBe('row@1')
    expect(orderedActions(withGap).map((action) => action.callId)).toEqual([
      'call@1',
      'row@1'
    ])
    expect(actionByCallId(withGap, 'row@1').command).toBe(anonymous)
  })
})

describe('actionStatus', () => {
  const failed = row('a', { error: { name: 'Error', message: 'boom' } })

  it('reads a failed row, a retried row and a passing one', () => {
    expect(actionStatus(failed, new Set())).toBe('failed')
    expect(actionStatus(failed, new Set([failed]))).toBe('retried')
    expect(actionStatus(row('b'), new Set())).toBe('passed')
  })
})
