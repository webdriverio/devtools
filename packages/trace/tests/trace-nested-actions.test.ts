import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'
import type { CommandLog } from '@wdio/devtools-shared'

import {
  buildActionEvents,
  type ActionEvent,
  type BeforeEvent
} from '../src/trace-action-events.js'
import { FrameSnapshotIndex } from '../src/trace-frame-snapshots.js'
import {
  FLAT_COMMANDS,
  FLAT_SNAPSHOTS,
  FLAT_TEST_METADATA
} from './fixtures/flat-action-stream.js'

const PAGE = 'page@1'
const WALL = 900

const row = (
  command: string,
  startTime: number,
  timestamp: number,
  extra: Partial<CommandLog> = {}
): CommandLog => ({ command, args: [], startTime, timestamp, ...extra })

const befores = (events: ActionEvent[]) =>
  events.filter((e): e is BeforeEvent => e.type === 'before')
const byTitle = (events: ActionEvent[], method: string) =>
  befores(events).find((e) => e.method === method)!
const endOf = (events: ActionEvent[], callId: string) =>
  events.find((e) => e.type === 'after' && e.callId === callId) as {
    endTime: number
  }

describe('buildActionEvents with nested rows', () => {
  it('writes a stream without parentId exactly as before nesting existed', () => {
    // The golden file was written by the implementation that predates parentId.
    const golden: unknown = JSON.parse(
      readFileSync(
        new URL('./fixtures/flat-action-events.json', import.meta.url),
        'utf8'
      )
    )
    const events = buildActionEvents(
      FLAT_COMMANDS,
      PAGE,
      WALL,
      FLAT_TEST_METADATA,
      new FrameSnapshotIndex(FLAT_SNAPSHOTS)
    )
    expect(JSON.stringify(events)).toBe(JSON.stringify(golden))
  })

  it("nests a wait's children under its callId and closes the wait after them", () => {
    const commands = [
      row('waitUntil', 1000, 1200, { id: 1 }),
      row('getText', 1010, 1020, { id: 2, parentId: 1, args: ['#flash'] }),
      row('getText', 1030, 1040, { id: 3, parentId: 1, args: ['h2'] }),
      row('click', 1210, 1220, { id: 4, args: ['#logout'] })
    ]
    const events = buildActionEvents(commands, PAGE, WALL)
    const wait = byTitle(events, 'waitForFunction')
    const reads = befores(events).filter((e) => e.method === 'getText')
    expect(reads.map((r) => r.parentId)).toEqual([wait.callId, wait.callId])
    // Children keep their own span inside the wait's instead of being floored past its end.
    expect(reads.map((r) => r.startTime)).toEqual([110, 130])
    expect(endOf(events, wait.callId).endTime).toBe(300)
    expect(events.map((e) => `${e.type} ${e.callId}`)).toEqual([
      `before ${wait.callId}`,
      `before ${reads[0].callId}`,
      `after ${reads[0].callId}`,
      `before ${reads[1].callId}`,
      `after ${reads[1].callId}`,
      `after ${wait.callId}`,
      'before call@4',
      'after call@4'
    ])
    expect(byTitle(events, 'click').parentId).toBeUndefined()
  })

  it('nests a child inside the test group its parent opened', () => {
    const commands = [
      row('waitForExist', 1000, 1200, { id: 1, testUid: 't2' }),
      row('isExisting', 1010, 1020, { id: 2, parentId: 1, testUid: 't2' })
    ]
    const events = buildActionEvents(commands, PAGE, WALL, FLAT_TEST_METADATA)
    const group = byTitle(events, 'tracingGroup')
    const wait = byTitle(events, 'waitForExist')
    expect(wait.parentId).toBe(group.callId)
    expect(byTitle(events, 'isExisting').parentId).toBe(wait.callId)
  })

  it('extends a parent whose last child completes after it', () => {
    const commands = [
      row('waitUntil', 1000, 1010, { id: 1 }),
      row('getText', 1005, 1050, { id: 2, parentId: 1 })
    ]
    const events = buildActionEvents(commands, PAGE, WALL)
    expect(endOf(events, byTitle(events, 'waitForFunction').callId)).toEqual(
      expect.objectContaining({ endTime: 150 })
    )
  })

  it('passes the children of a row the vocabulary drops up to its level', () => {
    const commands = [
      row('findElements', 1000, 1100, { id: 1 }),
      row('getText', 1010, 1020, { id: 2, parentId: 1 })
    ]
    const events = buildActionEvents(commands, PAGE, WALL)
    expect(befores(events).map((e) => [e.method, e.parentId])).toEqual([
      ['getText', undefined]
    ])
  })

  it('leaves a row whose parent is not in the stream at its own level', () => {
    const events = buildActionEvents(
      [row('getText', 1010, 1020, { id: 2, parentId: 99 })],
      PAGE,
      WALL
    )
    expect(befores(events).map((e) => e.parentId)).toEqual([undefined])
  })
})
