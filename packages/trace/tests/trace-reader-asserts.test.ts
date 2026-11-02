import { describe, it, expect } from 'vitest'
import { zipSync, strToU8 } from 'fflate'
import { parseTraceZip } from '../src/trace-reader.js'
import { REVERSE_ACTION_MAP } from '../src/trace-reader-constants.js'

const WALL_TIME = 1_000_000

const toNdjson = (events: object[]): Uint8Array =>
  strToU8(events.map((event) => JSON.stringify(event)).join('\n') + '\n')

// Assert events exactly as core's exporter writes them: semantic
// actual/expected/message params plus the numeric echo of the raw args.
function assertFixtureZip(): Uint8Array {
  const events = [
    {
      type: 'context-options',
      wallTime: WALL_TIME,
      browserName: 'chrome',
      contextId: 'context@ab12cd34',
      options: {}
    },
    {
      type: 'before',
      callId: 'call@1',
      startTime: 100,
      class: 'Assert',
      method: 'strictEqual',
      params: { '0': 'a', '1': 'a', actual: 'a', expected: 'a' },
      title: 'assert.strictEqual("a", "a")',
      apiName: 'assert.strictEqual'
    },
    { type: 'after', callId: 'call@1', endTime: 110 },
    {
      type: 'before',
      callId: 'call@2',
      startTime: 200,
      class: 'Assert',
      method: 'strictEqual',
      params: { '0': 'a', '1': 'b', actual: 'a', expected: 'b' },
      title: 'assert.strictEqual("a", "b")',
      apiName: 'assert.strictEqual'
    },
    {
      type: 'after',
      callId: 'call@2',
      endTime: 210,
      error: { message: 'a !== b' }
    },
    {
      type: 'before',
      callId: 'call@3',
      startTime: 300,
      class: 'Assert',
      method: 'toBe',
      params: { '0': 1, '1': 2, actual: 1, expected: 2 },
      title: 'expect.toBe(1, 2)',
      apiName: 'assert.toBe'
    },
    {
      type: 'after',
      callId: 'call@3',
      endTime: 310,
      error: { message: '1 !== 2' }
    }
  ]
  return zipSync({ 'trace.trace': toNdjson(events) })
}

describe('REVERSE_ACTION_MAP assert entries', () => {
  it('maps every tracked Assert.<m> action back to assert.<m>', () => {
    expect(REVERSE_ACTION_MAP['Assert.strictEqual']).toBe('assert.strictEqual')
    expect(REVERSE_ACTION_MAP['Assert.match']).toBe('assert.match')
    expect(REVERSE_ACTION_MAP['Assert.doesNotMatch']).toBe(
      'assert.doesNotMatch'
    )
    // Runner entries stay intact.
    expect(REVERSE_ACTION_MAP['Page.navigate']).toBe('url')
  })
})

describe('parseTraceZip with assert actions', () => {
  it('reads Assert rows back as assert.<m> commands with args round-tripped', () => {
    const { trace } = parseTraceZip(assertFixtureZip())
    expect(trace.commands.map((c) => c.command)).toEqual([
      'assert.strictEqual',
      'assert.strictEqual',
      // Untracked assert methods (synthesized expect matchers) fall back to
      // the bare method name.
      'toBe'
    ])
    expect(trace.commands[0].args).toEqual(['a', 'a'])
    expect(trace.commands[1].args).toEqual(['a', 'b'])
  })

  it('keeps the pass/fail split: error only on the failing assert', () => {
    const { trace } = parseTraceZip(assertFixtureZip())
    expect(trace.commands[0].error).toBeUndefined()
    expect(trace.commands[1].error?.message).toBe('a !== b')
    expect(trace.commands[2].error?.message).toBe('1 !== 2')
  })

  it('preserves the exporter-written assert titles', () => {
    const { trace } = parseTraceZip(assertFixtureZip())
    expect(trace.commands[0].title).toBe('assert.strictEqual("a", "a")')
    expect(trace.commands[2].title).toBe('expect.toBe(1, 2)')
  })
})
