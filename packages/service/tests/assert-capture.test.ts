import { describe, it, expect, vi, afterAll } from 'vitest'
import assert from 'node:assert'
import {
  ASSERT_PATCHED_SYMBOL,
  TRACKED_ASSERT_METHODS
} from '@wdio/devtools-core'
import {
  synthesizeExpectFailure,
  wireAssertCapture
} from '../src/assert-capture.js'
import type { SessionCapturer } from '../src/session.js'
import type { CommandLog } from '../src/types.js'

describe('synthesizeExpectFailure', () => {
  it('builds an expect.<matcher> entry from a matcherResult error', () => {
    const error = Object.assign(new Error('expected 1 to be 2'), {
      matcherResult: { matcherName: 'toBe', actual: 1, expected: 2 }
    })
    const entry = synthesizeExpectFailure(error, 'test-1')
    expect(entry).toMatchObject({
      command: 'expect.toBe',
      args: [1, 2],
      error: { name: 'Error', message: 'expected 1 to be 2' },
      testUid: 'test-1'
    })
    expect(typeof entry?.timestamp).toBe('number')
  })

  it('falls back to expect.assertion for bare expected/actual errors', () => {
    const error = Object.assign(new Error('nope'), {
      expected: 'a',
      actual: 'b'
    })
    const entry = synthesizeExpectFailure(error, undefined)
    expect(entry?.command).toBe('expect.assertion')
    expect(entry?.args).toEqual(['b', 'a'])
    expect(entry?.testUid).toBeUndefined()
  })

  it('skips node:assert AssertionErrors (already captured by the patcher)', () => {
    const error = Object.assign(new Error('a !== b'), {
      name: 'AssertionError',
      expected: 'b',
      actual: 'a'
    })
    expect(synthesizeExpectFailure(error, 'test-1')).toBeNull()
  })

  it('skips errors without a matcher shape and empty results', () => {
    expect(synthesizeExpectFailure(new Error('timeout'), 'test-1')).toBeNull()
    expect(synthesizeExpectFailure(undefined, 'test-1')).toBeNull()
    expect(synthesizeExpectFailure('string error', 'test-1')).toBeNull()
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
