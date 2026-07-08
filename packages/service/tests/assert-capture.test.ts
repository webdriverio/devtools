import { describe, it, expect, vi, afterAll } from 'vitest'
import assert from 'node:assert'
import {
  ASSERT_PATCHED_SYMBOL,
  TRACKED_ASSERT_METHODS
} from '@wdio/devtools-core'
import {
  captureExpectFailure,
  toCommandError,
  wireAssertCapture
} from '../src/assert-capture.js'
import type { SessionCapturer } from '../src/session.js'

describe('toCommandError', () => {
  it('normalizes a matcher Error object (ANSI stripped)', () => {
    const error = Object.assign(new Error('[31mexpected 1 to be 2[39m'), {
      matcherResult: { matcherName: 'toBe', actual: 1, expected: 2 }
    })
    expect(toCommandError(error)).toMatchObject({
      name: 'Error',
      message: 'expected 1 to be 2'
    })
  })

  it('wraps a Cucumber string message, stripping ANSI', () => {
    const raw = 'Expect to have text\n\nExpected: [32m"a"[39m'
    expect(toCommandError(raw)).toEqual({
      name: 'Error',
      message: 'Expect to have text\n\nExpected: "a"'
    })
  })

  it('returns undefined for node:assert AssertionError, empties and non-errors', () => {
    const assertionError = Object.assign(new Error('a !== b'), {
      name: 'AssertionError'
    })
    expect(toCommandError(assertionError)).toBeUndefined()
    expect(toCommandError('   ')).toBeUndefined()
    expect(toCommandError(undefined)).toBeUndefined()
    expect(toCommandError(42)).toBeUndefined()
  })
})

describe('captureExpectFailure', () => {
  function fakeCapturer() {
    return {
      failLastAction: vi.fn().mockReturnValue(true)
    } as unknown as SessionCapturer & {
      failLastAction: ReturnType<typeof vi.fn>
    }
  }

  it('marks the last action with the normalized error', () => {
    const capturer = fakeCapturer()
    captureExpectFailure(capturer, 'test-1', 'boom', true)
    expect(capturer.failLastAction).toHaveBeenCalledWith('test-1', {
      name: 'Error',
      message: 'boom'
    })
  })

  it('is a no-op when disabled or when there is no error', () => {
    const capturer = fakeCapturer()
    captureExpectFailure(capturer, 'test-1', 'boom', false)
    captureExpectFailure(capturer, 'test-1', undefined, true)
    expect(capturer.failLastAction).not.toHaveBeenCalled()
  })
})

describe('wireAssertCapture', () => {
  // Snapshot real methods so the process-wide patch is undone after this file.
  const ASSERT_MUT = assert as unknown as Record<string | symbol, unknown>
  const originals: Record<string, unknown> = {}
  for (const method of TRACKED_ASSERT_METHODS) {
    originals[method] = ASSERT_MUT[method]
  }
  afterAll(() => {
    delete ASSERT_MUT[ASSERT_PATCHED_SYMBOL]
    for (const method of TRACKED_ASSERT_METHODS) {
      ASSERT_MUT[method] = originals[method]
    }
  })

  it('routes patched asserts into the capturer with the current test uid', () => {
    const entries: CommandLog[] = []
    const live: { capturer?: SessionCapturer; uid?: string } = {}
    wireAssertCapture(
      () => live.capturer as SessionCapturer,
      () => live.uid
    )

    // Fake narrowed to the single method the wiring uses.
    live.capturer = {
      captureAssertCommand: (entry: CommandLog) => entries.push(entry)
    } as unknown as SessionCapturer
    live.uid = 'uid-1'
    assert.equal(1, 1)
    expect(entries[0]).toMatchObject({
      command: 'assert.equal',
      args: [1, 1],
      result: 'passed',
      testUid: 'uid-1'
    })

    live.uid = 'uid-2'
    expect(() => assert.strictEqual('a', 'b')).toThrow()
    const failed = entries[1]
    expect(failed.command).toBe('assert.strictEqual')
    expect(failed.testUid).toBe('uid-2')
    expect(failed.error).toMatchObject({ name: 'AssertionError' })
    expect(failed.result).toBeUndefined()
  })

  it('is a no-op wiring when invoked twice (per-process patch guard)', () => {
    const spy = vi.fn()
    wireAssertCapture(
      () => ({ captureAssertCommand: spy }) as unknown as SessionCapturer,
      () => undefined
    )
    assert.ok(true)
    expect(spy).not.toHaveBeenCalled()
  })
})
