import { describe, it, expect, beforeEach, vi } from 'vitest'
import assert from 'node:assert'
import {
  ASSERT_PATCHED_SYMBOL,
  TRACKED_ASSERT_METHODS,
  capturedAssertToCommandLog,
  matcherAssertionToCommandLog,
  patchNodeAssert,
  safeSerializeAssertArg,
  type CapturedAssert
} from '../src/assert-patcher.js'
import { getCallSourceFromStack } from '../src/stack.js'

// Stub the call-source resolver so tests choose whether an assert looks like
// it originated in user code (a frame) or a dependency/internal (no frame).
vi.mock('../src/stack.js', () => ({
  getCallSourceFromStack: vi.fn()
}))

const USER_FRAME = {
  filePath: '/specs/login.ts',
  callSource: '/specs/login.ts:12:3'
}
const INTERNAL_FRAME = { filePath: undefined, callSource: 'unknown:0' }

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
  // Default: every assert looks like it came from user code so captures fire.
  vi.mocked(getCallSourceFromStack).mockReturnValue(USER_FRAME)
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

  // Only assertions that originate in user test code should reach the trace.
  // Dependency/framework-internal asserts have no user-code frame on the
  // stack (getCallSourceFromStack yields 'unknown:0') and must be dropped.
  describe('user-origin filtering', () => {
    it('drops a passing assert that has no user-code frame', () => {
      vi.mocked(getCallSourceFromStack).mockReturnValue(INTERNAL_FRAME)
      const captured: CapturedAssert[] = []
      patchNodeAssert((c) => captured.push(c))
      assert.equal(1, 1)
      expect(captured).toHaveLength(0)
    })

    it('drops a failing internal assert but still re-throws', () => {
      vi.mocked(getCallSourceFromStack).mockReturnValue(INTERNAL_FRAME)
      const captured: CapturedAssert[] = []
      patchNodeAssert((c) => captured.push(c))
      expect(() => assert.equal(1, 2)).toThrow()
      expect(captured).toHaveLength(0)
    })

    it('drops an internal async assert (rejects/doesNotReject)', async () => {
      vi.mocked(getCallSourceFromStack).mockReturnValue(INTERNAL_FRAME)
      const captured: CapturedAssert[] = []
      patchNodeAssert((c) => captured.push(c))
      await assert.doesNotReject(async () => 1)
      await expect(assert.rejects(async () => 1)).rejects.toThrow()
      expect(captured).toHaveLength(0)
    })

    it('keeps a user-origin assert and carries its callSource through', () => {
      vi.mocked(getCallSourceFromStack).mockReturnValue(USER_FRAME)
      const captured: CapturedAssert[] = []
      patchNodeAssert((c) => captured.push(c))
      assert.equal(1, 1)
      expect(() => assert.equal(1, 2)).toThrow()
      expect(captured).toHaveLength(2)
      expect(captured[0]).toMatchObject({
        result: 'passed',
        callSource: USER_FRAME.callSource
      })
      expect(captured[1].result).toBeUndefined()
      expect(captured[1].error).toBeInstanceOf(Error)
    })
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

  // Regression: node:assert dispatches match/doesNotMatch on a function
  // identity check against the module binding (`fn === assert.match` on
  // Node ≤20). A wrapper left installed during the call inverted `match`
  // into `doesNotMatch` — passing regexes threw and failing ones passed.
  describe('match/doesNotMatch inversion regression', () => {
    it('records a failed capture when match does not match', () => {
      const captured: CapturedAssert[] = []
      patchNodeAssert((c) => captured.push(c))
      expect(() => assert.match('a', /b/)).toThrow()
      expect(captured[0].command).toBe('assert.match')
      expect(captured[0].result).toBeUndefined()
      expect(captured[0].error).toBeInstanceOf(Error)
    })

    it('records a passed capture when match matches', () => {
      const captured: CapturedAssert[] = []
      patchNodeAssert((c) => captured.push(c))
      expect(() => assert.match('a', /a/)).not.toThrow()
      expect(captured[0].result).toBe('passed')
      expect(captured[0].error).toBeUndefined()
    })

    it('records a failed capture when doesNotMatch matches', () => {
      const captured: CapturedAssert[] = []
      patchNodeAssert((c) => captured.push(c))
      expect(() => assert.doesNotMatch('a', /a/)).toThrow()
      expect(captured[0].command).toBe('assert.doesNotMatch')
      expect(captured[0].result).toBeUndefined()
      expect(captured[0].error).toBeInstanceOf(Error)
    })

    it('records a passed capture when doesNotMatch does not match', () => {
      const captured: CapturedAssert[] = []
      patchNodeAssert((c) => captured.push(c))
      expect(() => assert.doesNotMatch('a', /b/)).not.toThrow()
      expect(captured[0].result).toBe('passed')
      expect(captured[0].error).toBeUndefined()
    })

    it('restores the original binding during the call and the wrapper after', () => {
      patchNodeAssert(() => {})
      const wrapped = ASSERT_MUT['throws']
      let duringCall: unknown
      assert.throws(() => {
        duringCall = ASSERT_MUT['throws']
        throw new Error('boom')
      })
      expect(duringCall).toBe(originals['throws'])
      expect(ASSERT_MUT['throws']).toBe(wrapped)
    })

    it('re-installs the wrapper after a failing call', () => {
      patchNodeAssert(() => {})
      const wrapped = ASSERT_MUT['equal']
      expect(() => assert.equal(1, 2)).toThrow()
      expect(ASSERT_MUT['equal']).toBe(wrapped)
    })
  })
})

describe('capturedAssertToCommandLog', () => {
  const base: CapturedAssert = {
    command: 'assert.strictEqual',
    args: ['a', 'b'],
    result: undefined,
    error: undefined,
    callSource: '/specs/login.ts:12:3',
    timestamp: 1234
  }

  it('maps the captured shape onto CommandLog with startTime = timestamp', () => {
    const entry = capturedAssertToCommandLog(
      { ...base, result: 'passed', error: undefined },
      'test-1'
    )
    expect(entry).toEqual({
      command: 'assert.strictEqual',
      args: ['a', 'b'],
      result: 'passed',
      timestamp: 1234,
      startTime: 1234,
      callSource: '/specs/login.ts:12:3',
      testUid: 'test-1'
    })
  })

  it('serializes the error to a plain {name, message, stack} object', () => {
    const error = new Error('expected a to be b')
    const entry = capturedAssertToCommandLog({ ...base, error })
    expect(entry.error).toEqual({
      name: 'Error',
      message: 'expected a to be b',
      stack: error.stack
    })
    expect(entry.testUid).toBeUndefined()
  })
})

describe('matcherAssertionToCommandLog', () => {
  it('builds a passing expect.<method> command (default prefix)', () => {
    const entry = matcherAssertionToCommandLog(
      { method: 'toHaveTitle', args: ['The Internet'], passed: true },
      'uid-1'
    )
    expect(entry).toMatchObject({
      command: 'expect.toHaveTitle',
      args: ['The Internet'],
      result: 'passed',
      testUid: 'uid-1'
    })
    expect(entry.error).toBeUndefined()
  })

  it('carries the ANSI-stripped message as the error when failed', () => {
    const entry = matcherAssertionToCommandLog({
      method: 'toHaveText',
      args: ['foo'],
      passed: false,
      message: () => '[31mexpected foo[39m'
    })
    expect(entry.result).toBeUndefined()
    expect(entry.error).toMatchObject({ message: 'expected foo' })
  })

  it('honors a non-default prefix and sanitizes args', () => {
    const entry = matcherAssertionToCommandLog({
      prefix: 'verify',
      method: 'equal',
      args: [/re/, () => 1],
      passed: true
    })
    expect(entry.command).toBe('verify.equal')
    // RegExp → string, function → '[Function]' (via safeSerializeAssertArg).
    expect(entry.args).toEqual(['/re/', '[Function]'])
  })
})
