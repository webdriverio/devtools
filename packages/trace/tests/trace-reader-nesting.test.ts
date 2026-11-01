import { strToU8, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import {
  retriedRows,
  type CommandLog,
  type TraceActionChild
} from '@wdio/devtools-shared'
import { buildActionEvents } from '../src/trace-action-events.js'

import { parseTraceZip } from '../src/trace-reader.js'

const WALL_TIME = 1_000_000

const zipOf = (events: object[]): Uint8Array =>
  zipSync({
    'trace.trace': strToU8(
      events.map((event) => JSON.stringify(event)).join('\n') + '\n'
    )
  })

const context = { type: 'context-options', wallTime: WALL_TIME }

function action(
  callId: string,
  startTime: number,
  endTime: number,
  [cls, method]: [string, string],
  extra: { parentId?: string; error?: string } = {}
): object[] {
  return [
    {
      type: 'before',
      callId,
      startTime,
      class: cls,
      method,
      params: {},
      ...(extra.parentId ? { parentId: extra.parentId } : {})
    },
    {
      type: 'after',
      callId,
      endTime,
      ...(extra.error ? { error: { message: extra.error } } : {})
    }
  ]
}

const group = (callId: string, startTime: number, endTime: number) => [
  {
    type: 'before',
    callId,
    startTime,
    class: 'Tracing',
    method: 'tracingGroup',
    params: { name: 'waits' }
  },
  { type: 'after', callId, endTime }
]

// Each node as the command name it reads back as, with its children.
function shape(children: TraceActionChild[], commands: string[]): unknown {
  return children.map((child) => {
    if ('group' in child) {
      return { [child.group.title]: shape(child.group.children, commands) }
    }
    const name = commands[child.commandIndex]
    return child.children ? { [name]: shape(child.children, commands) } : name
  })
}

describe('parseTraceZip: an action that issued others', () => {
  it('reads back the nesting the exporter writes', () => {
    const row = (
      command: string,
      startTime: number,
      extra: Partial<CommandLog>
    ): CommandLog => ({
      command,
      args: [],
      startTime: WALL_TIME + startTime,
      timestamp: WALL_TIME + startTime + 5,
      ...extra
    })
    const events = buildActionEvents(
      [
        { ...row('waitUntil', 0, { id: 1 }), timestamp: WALL_TIME + 100 },
        row('getText', 10, { id: 2, parentId: 1 }),
        row('getText', 20, { id: 3, parentId: 1 }),
        row('click', 200, { id: 4 })
      ],
      'page@1',
      WALL_TIME
    )
    const { trace, groups } = parseTraceZip(zipOf([context, ...events]))
    const names = trace.commands.map((c) => c.command)
    expect(shape(groups!, names)).toEqual([
      { waitUntil: ['getText', 'getText'] },
      'click'
    ])
  })

  it("keeps the wait a command row and nests its reads under it, inside the test's group", () => {
    const { trace, groups } = parseTraceZip(
      zipOf([
        context,
        ...group('call@1', 0, 400),
        ...action('call@2', 0, 300, ['Browser', 'waitForFunction'], {
          parentId: 'call@1',
          error: 'timed out'
        }),
        ...action('call@3', 10, 20, ['Element', 'getText'], {
          parentId: 'call@2'
        }),
        ...action('call@4', 30, 40, ['Element', 'getText'], {
          parentId: 'call@2'
        }),
        ...action('call@5', 310, 320, ['Element', 'click'], {
          parentId: 'call@1'
        })
      ])
    )
    const names = trace.commands.map((c) => c.command)
    expect(names).toEqual(['getText', 'getText', 'waitUntil', 'click'])
    expect(shape(groups!, names)).toEqual([
      { waits: [{ waitUntil: ['getText', 'getText'] }, 'click'] }
    ])
    expect(trace.commands[2].error?.message).toBe('timed out')
  })

  it('builds a tree from parented actions alone, with no group in the zip', () => {
    const { trace, groups } = parseTraceZip(
      zipOf([
        context,
        ...action('call@1', 0, 100, ['Element', 'waitForExist']),
        ...action('call@2', 10, 20, ['Element', 'isExisting'], {
          parentId: 'call@1'
        })
      ])
    )
    expect(
      shape(
        groups!,
        trace.commands.map((c) => c.command)
      )
    ).toEqual([{ waitForExist: ['isExisting'] }])
  })

  it('leaves a zip without parented actions or groups flat', () => {
    const { groups } = parseTraceZip(
      zipOf([context, ...action('call@1', 0, 100, ['Element', 'click'])])
    )
    expect(groups).toBeUndefined()
  })

  it("does not fail a test's group for an error one of a passing wait's reads raised", () => {
    const { groups } = parseTraceZip(
      zipOf([
        context,
        ...group('call@1', 0, 400),
        ...action('call@2', 0, 300, ['Browser', 'waitForFunction'], {
          parentId: 'call@1'
        }),
        ...action('call@3', 10, 20, ['Element', 'getText'], {
          parentId: 'call@2',
          error: 'stale element'
        })
      ])
    )
    const [root] = groups!
    expect('group' in root! && root.group.failed).toBeFalsy()
  })

  it('roots actions whose parent chain loops back on itself', () => {
    const { trace, groups } = parseTraceZip(
      zipOf([
        context,
        ...action('call@1', 0, 100, ['Element', 'waitForExist'], {
          parentId: 'call@2'
        }),
        ...action('call@2', 10, 20, ['Browser', 'waitForFunction'], {
          parentId: 'call@1'
        }),
        ...action('call@3', 30, 40, ['Element', 'click'], {
          parentId: 'call@3'
        })
      ])
    )
    expect(trace.commands).toHaveLength(3)
    expect(groups).toBeUndefined()
  })
  it("reads back a passing wait's failed poll as retried, with its message, and a timed-out wait's as failed", () => {
    const zipFor = (wait: Partial<CommandLog>) =>
      zipOf([
        context,
        ...buildActionEvents(
          [
            {
              command: 'waitUntil',
              args: [],
              id: 1,
              startTime: WALL_TIME,
              timestamp: WALL_TIME + 100,
              ...wait
            },
            {
              command: 'getText',
              args: ['#flash'],
              id: 2,
              parentId: 1,
              startTime: WALL_TIME + 10,
              timestamp: WALL_TIME + 20,
              error: { name: 'Error', message: 'no such element' }
            }
          ],
          'page@1',
          WALL_TIME
        )
      ])

    const passed = parseTraceZip(zipFor({ result: true })).trace.commands
    const [read, wait] = passed
    expect(read.error?.message).toBe('no such element')
    expect(read.parentId).toBe(wait.id)
    expect([...retriedRows(passed)]).toEqual([read])

    const failed = parseTraceZip(
      zipFor({ error: { name: 'Error', message: 'timed out' } })
    ).trace.commands
    expect(failed[0].error?.message).toBe('no such element')
    expect(retriedRows(failed).size).toBe(0)
  })
})
