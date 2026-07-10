import { describe, it, expect, vi, afterAll } from 'vitest'
import assert from 'node:assert'
import {
  ASSERT_PATCHED_SYMBOL,
  TRACKED_ASSERT_METHODS
} from '@wdio/devtools-core'
import {
  captureExpectFailure,
  expectAssertionToCommandLog,
  resolveAssertionCallSource,
  toCommandError,
  wireAssertCapture
} from '../src/assert-capture.js'
import type { SessionCapturer } from '../src/session.js'

const stackFrames = vi.hoisted(() => ({
  value: [] as Array<{
    getFileName: () => string | null
    getLineNumber: () => number | null
    getColumnNumber: () => number | null
  }>
}))

// Only resolveAssertionCallSource reads 'stack-trace'; node:assert capture uses
// core's stacktrace-parser path, so mocking here doesn't affect those tests.
vi.mock('stack-trace', () => ({ parse: () => stackFrames.value }))

const frame = (file: string | null, line = 1, column = 1) => ({
  getFileName: () => file,
  getLineNumber: () => line,
  getColumnNumber: () => column
})

describe('toCommandError', () => {
  it('normalizes a plain Error object (ANSI stripped)', () => {
    // Matcher errors are skipped now (afterAssertion owns them); a plain
    // thrown Error still routes through failLastAction, so test that path.
    const error = new Error('[31msomething broke[39m')
    expect(toCommandError(error)).toMatchObject({
      name: 'Error',
      message: 'something broke'
    })
  })

  it('wraps a Cucumber string message, stripping ANSI', () => {
    const raw = 'Expect to have text\n\nExpected: [32m"a"[39m'
    expect(toCommandError(raw)).toEqual({
      name: 'Error',
      message: 'Expect to have text\n\nExpected: "a"'
    })
  })

  it('returns undefined for self-captured errors (AssertionError / matcher), empties and non-errors', () => {
    const assertionError = Object.assign(new Error('a !== b'), {
      name: 'AssertionError'
    })
    expect(toCommandError(assertionError)).toBeUndefined()
    // expect-webdriverio matcher errors carry matcherResult and are already
    // captured by afterAssertion — must not double-mark via failLastAction.
    const matcherError = Object.assign(new Error('expected a to be b'), {
      matcherResult: { pass: false }
    })
    expect(toCommandError(matcherError)).toBeUndefined()
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

  it('does not mark an action for a self-captured matcher error', () => {
    const capturer = fakeCapturer()
    // A failing expect-webdriverio matcher (carries matcherResult) is already
    // its own command via afterAssertion — failLastAction must stay off it.
    const matcherError = Object.assign(new Error('expected'), {
      matcherResult: { pass: false }
    })
    captureExpectFailure(capturer, 'test-1', matcherError, true)
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

describe('expectAssertionToCommandLog', () => {
  it('captures a passing matcher as an expect.<matcher> command', () => {
    const entry = expectAssertionToCommandLog(
      {
        matcherName: 'toHaveTitle',
        expectedValue: 'The Internet',
        result: { pass: true, message: () => 'ok' }
      },
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

  it('captures a failing matcher with its ANSI-stripped message as the error', () => {
    const entry = expectAssertionToCommandLog(
      {
        matcherName: 'toHaveText',
        expectedValue: 'foo',
        result: { pass: false, message: () => '[31mexpected foo[39m' }
      },
      undefined
    )
    expect(entry.result).toBeUndefined()
    expect(entry.error).toMatchObject({ message: 'expected foo' })
  })

  it('spreads an array expectedValue and reads the typed `result` flag', () => {
    // @wdio/types declares the pass flag on `result`, not `pass` — read both.
    const entry = expectAssertionToCommandLog(
      {
        matcherName: 'toHaveAttribute',
        expectedValue: ['href', '/x'],
        result: { result: true }
      },
      undefined
    )
    expect(entry).toMatchObject({
      command: 'expect.toHaveAttribute',
      args: ['href', '/x'],
      result: 'passed'
    })
  })

  it('treats a matcher with no expectedValue as a no-arg assertion', () => {
    const entry = expectAssertionToCommandLog(
      { matcherName: 'toBeClickable', result: { pass: true } },
      undefined
    )
    expect(entry).toMatchObject({ command: 'expect.toBeClickable', args: [] })
  })

  it('forwards the captured callSource onto the assertion row', () => {
    const entry = expectAssertionToCommandLog(
      { matcherName: 'toExist', result: { pass: true } },
      'uid-1',
      '/proj/specs/login.e2e.ts:30:7'
    )
    expect(entry.callSource).toBe('/proj/specs/login.e2e.ts:30:7')
  })
})

describe('resolveAssertionCallSource', () => {
  it('returns the outermost user-spec frame and loads its source', () => {
    // innermost → outermost: service bundle, expect-webdriverio matcher, the
    // user spec, then node internals. The user spec must win, not the bundle.
    stackFrames.value = [
      frame('/repo/packages/service/dist/index.js', 4045, 12),
      frame('/repo/node_modules/expect-webdriverio/lib/matchers.js', 9, 3),
      frame('/proj/specs/login.e2e.ts', 30, 7),
      frame('node:internal/process/task_queues', 95, 5)
    ]
    const captured: string[] = []
    const callSource = resolveAssertionCallSource((f) => captured.push(f))
    expect(callSource).toBe('/proj/specs/login.e2e.ts:30:7')
    expect(callSource).not.toContain('/dist/')
    expect(captured).toEqual(['/proj/specs/login.e2e.ts'])
  })

  it('returns undefined and loads nothing when only dependency frames exist', () => {
    stackFrames.value = [
      frame('/repo/node_modules/expect-webdriverio/lib/matchers.js', 9, 3),
      frame('node:internal/process/task_queues', 95, 5)
    ]
    const captured: string[] = []
    expect(resolveAssertionCallSource((f) => captured.push(f))).toBeUndefined()
    expect(captured).toEqual([])
  })
})
