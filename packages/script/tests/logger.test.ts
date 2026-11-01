import { beforeEach, describe, expect, it } from 'vitest'
import { clearLogs, getLogs, log } from '../src/logger.js'

describe('script/logger', () => {
  beforeEach(() => clearLogs())

  it('appends a JSON-serialized line per call', () => {
    log('hello', 42)
    log({ a: 1 })
    expect(getLogs()).toEqual(['"hello" 42', '{"a":1}'])
  })

  it('joins multiple args with a single space', () => {
    log('a', 'b', 'c')
    expect(getLogs()).toEqual(['"a" "b" "c"'])
  })

  it('clearLogs wipes the buffer', () => {
    log('x')
    clearLogs()
    expect(getLogs()).toEqual([])
  })

  it('getLogs returns the live buffer (callers must not mutate)', () => {
    log('one')
    const snap = getLogs()
    log('two')
    expect(snap).toEqual(['"one"', '"two"'])
  })

  it('renders undefined args as an empty slot (JSON.stringify(undefined) → undefined)', () => {
    log('a', undefined, 'b')
    // JSON.stringify(undefined) returns undefined, and Array#join coerces it to ''
    expect(getLogs()).toEqual(['"a"  "b"'])
  })
})
