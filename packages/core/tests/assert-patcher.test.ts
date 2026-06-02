import { describe, it, expect, beforeEach } from 'vitest'
import assert from 'node:assert'
import {
  ASSERT_PATCHED_SYMBOL,
  TRACKED_ASSERT_METHODS,
  patchNodeAssert,
  safeSerializeAssertArg,
  type CapturedAssert
} from '../src/assert-patcher.js'

// Snapshot real methods once so each test starts from a fresh assert.
const ASSERT_MUT = assert as unknown as Record<string | symbol, unknown>
const originals: Record<string, unknown> = {}
for (const m of TRACKED_ASSERT_METHODS) {
  originals[m] = ASSERT_MUT[m]
}

beforeEach(() => {
  delete ASSERT_MUT[ASSERT_PATCHED_SYMBOL]
  for (const m of TRACKED_ASSERT_METHODS) {
    ASSERT_MUT[m] = originals[m]
  }
})

describe('safeSerializeAssertArg', () => {
  // One sweep covers every branch — function, RegExp, plain object,
  // cyclic-object fallback, passthrough primitives.
  it('coerces each input class to a JSON-safe value', () => {
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(safeSerializeAssertArg(/foo/gi)).toBe('/foo/gi')
    expect(safeSerializeAssertArg(() => 0)).toBe('[Function]')
    expect(safeSerializeAssertArg({ a: 1 })).toEqual({ a: 1 })
    expect(safeSerializeAssertArg(cyclic)).toBe('[object Object]')
    expect(safeSerializeAssertArg(42)).toBe(42)
    expect(safeSerializeAssertArg(null)).toBe(null)
  })
})

describe('patchNodeAssert', () => {
  it('emits a passed capture on sync success', () => {
    const captured: CapturedAssert[] = []
    expect(patchNodeAssert((c) => captured.push(c))).toBe(true)
    assert.equal(1, 1)
    expect(captured[0]).toMatchObject({
      command: 'assert.equal',
      args: [1, 1],
      result: 'passed',
      error: undefined
    })
  })

  it('emits a failed capture (with the thrown error) and re-throws on sync failure', () => {
    const captured: CapturedAssert[] = []
    patchNodeAssert((c) => captured.push(c))
    expect(() => assert.equal(1, 2)).toThrow()
    expect(captured[0].result).toBeUndefined()
    expect(captured[0].error).toBeInstanceOf(Error)
  })

  it('handles Promise-returning asserts (rejects/doesNotReject)', async () => {
    const captured: CapturedAssert[] = []
    patchNodeAssert((c) => captured.push(c))
    await assert.doesNotReject(async () => 1)
    await expect(assert.rejects(async () => 1)).rejects.toThrow()
    const results = captured.map((c) => c.result)
    expect(results).toEqual(['passed', undefined]) // first resolved, second rejected
  })

  it('is idempotent — second patch is a no-op and sets the guard symbol', () => {
    const a: CapturedAssert[] = []
    patchNodeAssert((c) => a.push(c))
    const wrapped = ASSERT_MUT['equal']
    const b: CapturedAssert[] = []
    patchNodeAssert((c) => b.push(c))
    expect(ASSERT_MUT['equal']).toBe(wrapped) // same wrapper, NOT re-bound
    expect(ASSERT_MUT[ASSERT_PATCHED_SYMBOL]).toBe(true)
    assert.equal(1, 1)
    expect(a).toHaveLength(1)
    expect(b).toHaveLength(0) // second callback never bound
  })

  it('serializes RegExp args before invoking onCommand', () => {
    const captured: CapturedAssert[] = []
    patchNodeAssert((c) => captured.push(c))
    assert.match('hello', /hello/)
    expect(captured[0].args).toEqual(['hello', '/hello/'])
  })
})
