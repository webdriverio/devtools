import { describe, it, expect, vi, beforeEach } from 'vitest'
import type {
  CommandLog,
  NightwatchBrowser,
  NightwatchCurrentTest
} from '../src/types.js'

// browserProxy resolves the caller's source via this helper; stub it so each
// test can decide whether the command looks user-issued or framework-internal.
// vi.hoisted so the stub exists when the hoisted vi.mock factory runs.
const { getCallSourceFromStack } = vi.hoisted(() => ({
  getCallSourceFromStack: vi.fn()
}))
vi.mock('../src/helpers/utils.js', () => ({ getCallSourceFromStack }))

import { BrowserProxy } from '../src/helpers/browserProxy.js'
import { captureNativeAssertions } from '../src/helpers/nativeAssertions.js'
import type { SessionCapturer } from '../src/session.js'
import type { TestManager } from '../src/helpers/testManager.js'

function makeCapturer() {
  const commandsLog: (CommandLog & { _id?: number })[] = []
  let counter = 0
  const captureCommand = vi.fn(
    async (
      command: string,
      args: unknown[],
      result: unknown,
      error: Error | undefined,
      testUid?: string,
      callSource?: string,
      timestamp?: number
    ) => {
      commandsLog.push({
        _id: counter++,
        command,
        args,
        result,
        error,
        testUid,
        callSource,
        timestamp
      })
      return true
    }
  )
  const captureAssertCommand = vi.fn(
    (entry: CommandLog & { _id?: number; id?: number }) => {
      entry._id = counter++
      entry.id = entry._id
      commandsLog.push(entry)
    }
  )
  const capturer = {
    commandsLog,
    captureCommand,
    captureAssertCommand,
    replaceCommand: vi.fn(),
    sendCommand: vi.fn(),
    sendReplaceCommand: vi.fn(),
    takeScreenshotViaHttp: vi.fn(async () => null),
    captureTrace: vi.fn(async () => {})
  } as unknown as SessionCapturer
  return { capturer, commandsLog, captureCommand, captureAssertCommand }
}

function makeTestManager() {
  return {
    detectTestBoundary: vi.fn(() => ''),
    startTestIfPending: vi.fn()
  } as unknown as TestManager
}

/** A browser whose single command echoes its result into the capture callback
 *  Nightwatch appends as the last argument. */
function makeBrowser() {
  return {
    titleContains: (_arg: unknown, cb: (result: unknown) => void) => {
      cb('Example Domain')
      return undefined
    }
  } as unknown as NightwatchBrowser
}

describe('BrowserProxy internal-command suppression', () => {
  beforeEach(() => {
    getCallSourceFromStack.mockReset()
  })

  it('captures a command issued from a user-code frame', () => {
    const { capturer, commandsLog, captureCommand } = makeCapturer()
    getCallSourceFromStack.mockReturnValue({
      filePath: '/tests/spec.js',
      callSource: '/tests/spec.js:5'
    })
    const proxy = new BrowserProxy(capturer, makeTestManager(), () => ({
      uid: 'test-1'
    }))
    const browser = makeBrowser()
    proxy.wrapBrowserCommands(browser)
    ;(
      browser as unknown as Record<string, (a: unknown) => unknown>
    ).titleContains('Example')

    expect(captureCommand).toHaveBeenCalledTimes(1)
    expect(commandsLog).toHaveLength(1)
    expect(commandsLog[0].command).toBe('titleContains')
    expect(commandsLog[0].callSource).toBe('/tests/spec.js:5')
  })

  it('suppresses a framework-internal command with no user-code frame', () => {
    const { capturer, commandsLog, captureCommand } = makeCapturer()
    // Mirrors the getTitle a `browser.assert.titleContains` issues from inside
    // Nightwatch's queue: no user frame, so getCallSourceFromStack returns none.
    getCallSourceFromStack.mockReturnValue({
      filePath: undefined,
      callSource: 'unknown:0'
    })
    const proxy = new BrowserProxy(capturer, makeTestManager(), () => ({
      uid: 'test-1'
    }))
    const browser = makeBrowser()
    proxy.wrapBrowserCommands(browser)
    ;(
      browser as unknown as Record<string, (a: unknown) => unknown>
    ).titleContains('Example')

    expect(captureCommand).not.toHaveBeenCalled()
    expect(commandsLog).toHaveLength(0)
  })
})

describe('BrowserProxy captureAssertions gating', () => {
  beforeEach(() => {
    getCallSourceFromStack.mockReset()
  })

  /** A browser exposing `assert`/`verify` namespace objects (as Nightwatch
   *  does), so the test can check whether wrapAssertionNamespaces replaced them
   *  with a recording Proxy. */
  function makeAssertBrowser() {
    return {
      assert: { titleContains: vi.fn() },
      verify: { titleContains: vi.fn() }
    } as unknown as NightwatchBrowser & {
      assert: object
      verify: object
    }
  }

  it('leaves assert/verify namespaces original when captureAssertions is false', () => {
    const { capturer } = makeCapturer()
    const browser = makeAssertBrowser()
    const originalAssert = browser.assert
    const originalVerify = browser.verify
    const proxy = new BrowserProxy(
      capturer,
      makeTestManager(),
      () => ({ uid: 't1' }),
      false
    )
    proxy.wrapBrowserCommands(browser)
    // No wrapping → the namespaces are untouched, so no pending rows can stream.
    expect(browser.assert).toBe(originalAssert)
    expect(browser.verify).toBe(originalVerify)
  })

  it('wraps assert/verify namespaces by default (captureAssertions true)', () => {
    const { capturer } = makeCapturer()
    const browser = makeAssertBrowser()
    const originalAssert = browser.assert
    const originalVerify = browser.verify
    const proxy = new BrowserProxy(capturer, makeTestManager(), () => ({
      uid: 't1'
    }))
    proxy.wrapBrowserCommands(browser)
    // Replaced with a recording Proxy → no longer the original object.
    expect(browser.assert).not.toBe(originalAssert)
    expect(browser.verify).not.toBe(originalVerify)
  })
})

describe('BrowserProxy negated native assertions (assert.not.* / verify.not.*)', () => {
  beforeEach(() => {
    getCallSourceFromStack.mockReset()
  })

  /** Browser whose assert/verify mirror Nightwatch's structure: a positive
   *  namespace plus a nested `not` namespace object (Nightwatch exposes the
   *  negation as its own Proxy). Each leaf method records so the test can assert
   *  the wrapper still delegates to the real negated method. */
  function makeNegatableAssertBrowser() {
    const record: string[] = []
    const ns = (label: string) => ({
      titleContains: vi.fn(() => {
        record.push(`${label}titleContains`)
      })
    })
    const browser = {
      assert: { ...ns(''), not: ns('not.') },
      verify: { ...ns(''), not: ns('not.') }
    } as unknown as NightwatchBrowser
    return { browser, record }
  }

  it('buffers a negated assert with a negation-reflecting label and finalizes its outcome', async () => {
    const { capturer, commandsLog } = makeCapturer()
    getCallSourceFromStack.mockReturnValue({
      filePath: '/tests/spec.js',
      callSource: '/tests/spec.js:9'
    })
    const proxy = new BrowserProxy(capturer, makeTestManager(), () => ({
      uid: 't1'
    }))
    const { browser, record } = makeNegatableAssertBrowser()
    proxy.wrapBrowserCommands(browser)

    // browser.assert.not.titleContains('Example') — a negated call from user code.
    ;(
      browser as unknown as {
        assert: { not: { titleContains: (a: unknown) => unknown } }
      }
    ).assert.not.titleContains('Example')

    // Delegated to the ORIGINAL negated method (Nightwatch semantics unchanged).
    expect(record).toEqual(['not.titleContains'])

    // Buffered exactly one recorded call, keyed by its full dotted path — so the
    // negation is captured through the SAME mechanism as positive asserts.
    const calls = proxy.drainNativeAssertCalls()
    expect(calls).toHaveLength(1)
    expect(calls[0].prefix).toBe('assert')
    expect(calls[0].method).toBe('not.titleContains')
    expect(calls[0].args).toEqual(['Example'])
    expect(calls[0].callSource).toBe('/tests/spec.js:9')
    expect(calls[0].entry?.command).toBe('assert.not.titleContains')
    expect(calls[0].entry?.title).toBe("assert.not.titleContains('Example')")

    // Reconciled at test-end through the same finalize path as positive asserts:
    // a failing negated entry yields one row with the negated label + fail outcome.
    const results = {
      assertions: [
        {
          message: "Testing if the page title doesn't contain 'Example'",
          fullMsg: "Testing if the page title doesn't contain 'Example'",
          failure:
            "Testing if the page title doesn't contain 'Example' — failed"
        }
      ],
      commands: []
    }
    const currentTest = {
      name: 't',
      results
    } as unknown as NightwatchCurrentTest
    await captureNativeAssertions(capturer, browser, currentTest, 't1', calls)

    const row = commandsLog[commandsLog.length - 1]
    expect(row.command).toBe('assert.not.titleContains')
    expect(row.title).toBe("assert.not.titleContains('Example')")
    expect(row.result).toMatchObject({ passed: false })
    expect(row.error).toBeDefined()
  })
})
