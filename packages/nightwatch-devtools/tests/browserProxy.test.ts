import { describe, it, expect, vi, beforeEach } from 'vitest'
import { selectorForReadValue } from '@wdio/devtools-core'
import type {
  CommandCaptureMeta,
  CommandLog,
  NightwatchBrowser,
  NightwatchCurrentTest,
  SuiteStats,
  TestStats
} from '../src/types.js'

// browserProxy resolves the caller's source via this helper; stub it so each
// test can decide whether the command looks user-issued or framework-internal.
// vi.hoisted so the stub exists when the hoisted vi.mock factory runs.
const { getCallSourceFromStack } = vi.hoisted(() => ({
  getCallSourceFromStack: vi.fn()
}))
vi.mock('../src/helpers/utils.js', () => ({ getCallSourceFromStack }))

import { BrowserProxy } from '../src/helpers/browserProxy.js'
import { findRunningTest } from '../src/helpers/runningTest.js'
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
      meta: CommandCaptureMeta = {}
    ) => {
      commandsLog.push({
        _id: counter++,
        command,
        args,
        result,
        error,
        ...meta,
        timestamp: meta.timestamp ?? Date.now()
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
    captureTrace: vi.fn(async () => {}),
    injectScript: vi.fn(async () => {}),
    anchorAfterNavigation: vi.fn(async () => {}),
    snapshotCaptures: [] as Promise<void>[]
  } as unknown as SessionCapturer
  return { capturer, commandsLog, captureCommand, captureAssertCommand }
}

/** `runningTest` answers "no per-`it` testcase" by default, which is the
 *  cucumber/unparsed-spec shape: rows then fall back to the lifecycle test. */
function makeTestManager(
  runningTest?: (
    currentTest: NightwatchCurrentTest | undefined
  ) => TestStats | undefined
) {
  return {
    detectTestBoundary: vi.fn(() => ''),
    startTestIfPending: vi.fn(),
    runningTest: vi.fn(runningTest ?? (() => undefined))
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

describe('BrowserProxy per-testcase row tagging', () => {
  beforeEach(() => {
    getCallSourceFromStack.mockReset()
    getCallSourceFromStack.mockReturnValue({
      filePath: '/tests/spec.js',
      callSource: '/tests/spec.js:9'
    })
  })

  const SUITE = {
    uid: 'suite-uid',
    title: 'smoke',
    tests: [
      { uid: 'uid-a', title: 'first it', state: 'pending' },
      { uid: 'uid-b', title: 'second it', state: 'pending' }
    ]
  } as unknown as SuiteStats

  /** Browser whose `currentTest` is live state the runner mutates per `it` —
   *  Nightwatch installs it as a getter over the reporter's current testcase. */
  function makeTestcaseBrowser() {
    const browser = {
      currentTest: { name: 'first it' } as NightwatchCurrentTest,
      click: (...args: unknown[]) => {
        const cb = args[args.length - 1]
        if (typeof cb === 'function') {
          ;(cb as (r: unknown) => void)({ value: null })
        }
        return undefined
      },
      assert: { urlContains: vi.fn() },
      verify: { urlContains: vi.fn() }
    } as unknown as NightwatchBrowser
    return browser
  }

  function proxyOver(browser: NightwatchBrowser) {
    const { capturer, commandsLog } = makeCapturer()
    const proxy = new BrowserProxy(
      capturer,
      makeTestManager((currentTest) => findRunningTest(SUITE, currentTest)),
      // The lifecycle test: on the BDD interface `beforeEach` fires once per
      // module, so it is pinned to the FIRST `it` for the whole file.
      () => ({ uid: 'uid-a' })
    )
    proxy.wrapBrowserCommands(browser)
    return { proxy, commandsLog }
  }

  it('tags each command with the `it` Nightwatch is running, not the module’s first', () => {
    const browser = makeTestcaseBrowser()
    const { commandsLog } = proxyOver(browser)
    const b = browser as unknown as Record<string, (...a: unknown[]) => unknown>

    b.click('#a')
    ;(browser.currentTest as NightwatchCurrentTest).name = 'second it'
    b.click('#b')

    expect(commandsLog.map((c) => c.testUid)).toEqual(['uid-a', 'uid-b'])
  })

  it('keeps one uid while the reported testcase is unchanged', () => {
    const browser = makeTestcaseBrowser()
    const { commandsLog } = proxyOver(browser)
    const b = browser as unknown as Record<string, (...a: unknown[]) => unknown>

    b.click('#a')
    b.click('#b')

    expect(commandsLog.map((c) => c.testUid)).toEqual(['uid-a', 'uid-a'])
  })

  it('tags a native assert buffered at call time with the running `it` too', () => {
    // Assert rows are emitted in a test-end batch but positioned back on their
    // real execution window, so a stale uid would reopen an earlier test's group
    // in the middle of a later one.
    const browser = makeTestcaseBrowser()
    const { proxy } = proxyOver(browser)
    ;(browser.currentTest as NightwatchCurrentTest).name = 'second it'
    ;(
      browser as unknown as { assert: { urlContains: (a: unknown) => unknown } }
    ).assert.urlContains('/secure')

    expect(proxy.drainNativeAssertCalls()[0].entry?.testUid).toBe('uid-b')
  })

  it('falls back to the lifecycle test when no testcase is reported (cucumber)', () => {
    // Cucumber's client carries no `currentTest`; its rows stay on the
    // per-scenario lifecycle test, which is what keeps its groups unchanged.
    const browser = makeTestcaseBrowser()
    ;(browser as { currentTest?: NightwatchCurrentTest }).currentTest =
      undefined
    const { commandsLog } = proxyOver(browser)
    ;(browser as unknown as Record<string, (...a: unknown[]) => unknown>).click(
      '#a'
    )

    expect(commandsLog[0].testUid).toBe('uid-a')
  })
})

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

describe('BrowserProxy read-value provenance', () => {
  beforeEach(() => {
    getCallSourceFromStack.mockReset()
    getCallSourceFromStack.mockReturnValue({
      filePath: '/tests/spec.js',
      callSource: '/tests/spec.js:12'
    })
  })

  /** Commands that echo a W3C-wrapped value into the capture callback, the way
   *  Nightwatch's queue hands a read's result back. */
  function makeReadBrowser(value: unknown) {
    // The wrapper appends the capture callback as the LAST argument, so every
    // fake command answers the same way regardless of its own arity.
    const echo = (...args: unknown[]) => {
      const cb = args[args.length - 1]
      if (typeof cb === 'function') {
        ;(cb as (r: unknown) => void)({ value })
      }
      return undefined
    }
    return {
      getText: echo,
      title: echo,
      url: echo
    } as unknown as NightwatchBrowser
  }

  function proxied(browser: NightwatchBrowser) {
    const { capturer } = makeCapturer()
    const proxy = new BrowserProxy(capturer, makeTestManager(), () => ({
      uid: 'test-1'
    }))
    proxy.wrapBrowserCommands(browser)
    return browser as unknown as Record<string, (...a: unknown[]) => unknown>
  }

  it('attributes an element read to the selector it was read from', () => {
    // The link a node:assert has no other way to make: it compares VALUES, so
    // only the command that produced the value knows which element it came from.
    proxied(makeReadBrowser('provenance-flash-text')).getText('#flash')
    expect(selectorForReadValue('provenance-flash-text')).toBe('#flash')
  })

  it('attributes a page-level read to no element (the null sentinel)', () => {
    // `title` is not an element read, so its value must not keep an element's
    // claim standing — otherwise a title assertion boxes an element that merely
    // happens to read the same text (measured on the selenium mocha example).
    const shared = 'provenance-shared-text'
    proxied(makeReadBrowser(shared)).getText('h1')
    expect(selectorForReadValue(shared)).toBe('h1')
    proxied(makeReadBrowser(shared)).title()
    expect(selectorForReadValue(shared)).toBeUndefined()
  })

  it('does not read a url argument as a locator', () => {
    // `browser.url('https://…')` takes a string first too; treating it as a
    // locator would attribute the page's own reads to an "element".
    const browser = proxied(makeReadBrowser('provenance-url-result'))
    browser.url('https://example.com/login')
    expect(selectorForReadValue('provenance-url-result')).toBeUndefined()
  })

  it('records nothing for a failed read', () => {
    // A timeout's message is not a value the element ever held.
    const failing = {
      getText: (_sel: unknown, cb: (r: unknown) => void) => {
        cb({ error: 'timeout', message: 'Timed out on <#gone>' })
        return undefined
      }
    } as unknown as NightwatchBrowser
    proxied(failing).getText('#gone')
    expect(selectorForReadValue('Timed out on <#gone>')).toBeUndefined()
  })
})

describe('BrowserProxy row metadata', () => {
  beforeEach(() => {
    getCallSourceFromStack.mockReset()
    getCallSourceFromStack.mockReturnValue({
      filePath: '/tests/spec.js',
      callSource: '/tests/spec.js:9'
    })
  })

  /** A browser whose commands echo into the capture callback Nightwatch appends
   *  as the last argument. */
  function makeEchoBrowser() {
    const echo = (...args: unknown[]) => {
      const cb = args[args.length - 1]
      if (typeof cb === 'function') {
        ;(cb as (r: unknown) => void)({ value: null })
      }
      return undefined
    }
    return { click: echo, url: echo } as unknown as NightwatchBrowser
  }

  function capture(
    run: (b: Record<string, (...a: unknown[]) => unknown>) => void
  ) {
    const { capturer, commandsLog } = makeCapturer()
    const proxy = new BrowserProxy(capturer, makeTestManager(), () => ({
      uid: 'test-1'
    }))
    const browser = makeEchoBrowser()
    proxy.wrapBrowserCommands(browser)
    run(browser as unknown as Record<string, (...a: unknown[]) => unknown>)
    return commandsLog[0]
  }

  it('carries the target selector, issue order and invocation time on the row', () => {
    // The row says what it targeted rather than leaving the exporter to fall
    // back to args[0] — and both stamps ride in on the capture call instead of
    // being written onto the pushed row afterwards.
    const row = capture((b) => b.click('button[type="submit"]'))
    expect(row.selector).toBe('button[type="submit"]')
    expect(row.sequence).toBe(0)
    expect(row.startTime).toBeTypeOf('number')
    expect(row.startTime).toBeLessThanOrEqual(row.timestamp!)
  })

  it('leaves a page-level command with no selector', () => {
    const row = capture((b) => b.url('https://example.com/login'))
    expect(row.selector).toBeUndefined()
  })
})

describe('BrowserProxy navigation wrapping', () => {
  beforeEach(() => {
    getCallSourceFromStack.mockReset()
    getCallSourceFromStack.mockReturnValue({
      filePath: '/tests/spec.js',
      callSource: '/tests/spec.js:5'
    })
  })

  function makeUrlBrowser() {
    return {
      url: (...args: unknown[]) => {
        const cb = args[args.length - 1]
        if (typeof cb === 'function') {
          ;(cb as (r: unknown) => void)({ value: 'https://example.com/' })
        }
        return undefined
      }
    } as unknown as NightwatchBrowser
  }

  it('does not treat browser.url() as a navigation when it is a getter', () => {
    // assert.urlContains reads the current url via browser.url(cb) from inside
    // Nightwatch's queue. Treating that as a navigation re-injected the collector
    // and forced an anchored drain mid-test, for a command that changed nothing.
    const { capturer } = makeCapturer()
    const proxy = new BrowserProxy(capturer, makeTestManager(), () => ({
      uid: 'test-1'
    }))
    const browser = makeUrlBrowser()
    proxy.wrapUrlMethod(browser)
    ;(browser as unknown as Record<string, (...a: unknown[]) => unknown>).url(
      () => {}
    )
    expect(capturer.injectScript).not.toHaveBeenCalled()
  })

  it('still treats a url with a destination as a navigation', async () => {
    const { capturer } = makeCapturer()
    const proxy = new BrowserProxy(capturer, makeTestManager(), () => ({
      uid: 'test-1'
    }))
    const browser = makeUrlBrowser()
    proxy.wrapUrlMethod(browser)
    ;(browser as unknown as Record<string, (...a: unknown[]) => unknown>).url(
      'https://example.com/login'
    )
    // The non-chainable (cucumber async/await) branch defers injection onto the
    // returned promise, so let the microtask queue drain before asserting.
    await new Promise((resolve) => setImmediate(resolve))
    expect(capturer.injectScript).toHaveBeenCalled()
  })
})

describe('BrowserProxy async command failure', () => {
  beforeEach(() => {
    getCallSourceFromStack.mockReset()
    getCallSourceFromStack.mockReturnValue({
      filePath: '/tests/spec.js',
      callSource: '/tests/spec.js:37'
    })
  })

  /** Nightwatch reports an async failure (a command that timed out waiting for
   *  an element) by INVOKING the callback with an error-shaped result rather than
   *  throwing, so the try/catch around the original method never sees it. */
  function makeFailingBrowser(result: unknown) {
    return {
      click: (_sel: unknown, cb: (r: unknown) => void) => {
        cb(result)
        return undefined
      }
    } as unknown as NightwatchBrowser
  }

  function clickWith(result: unknown) {
    const ctx = makeCapturer()
    const proxy = new BrowserProxy(ctx.capturer, makeTestManager(), () => ({
      uid: 'test-1'
    }))
    const browser = makeFailingBrowser(result)
    proxy.wrapBrowserCommands(browser)
    ;(browser as unknown as Record<string, (a: unknown) => unknown>).click(
      'a*=Logout'
    )
    return ctx
  }

  it('surfaces the failure as the row error, not as the result', () => {
    // Left in `result`, the row kept error: undefined and rendered as a success
    // — no red row and nothing in the Errors tab.
    const { commandsLog } = clickWith({
      error: 'timeout',
      message:
        'An error occurred while running .click() command on <a*=Logout>: Timed out',
      stack: 'Error at BrowserProxy.handleCommandExecution'
    })
    expect(commandsLog).toHaveLength(1)
    expect(commandsLog[0].error).toBeInstanceOf(Error)
    expect((commandsLog[0].error as Error).message).toContain('Timed out')
    expect((commandsLog[0].error as Error).stack).toContain('BrowserProxy')
    expect(commandsLog[0].result).toBeUndefined()
  })

  it('finds the failure nested under a W3C value wrapper', () => {
    // Nightwatch passes the driver response through untouched, so the failure
    // sits under `value` — reading only the top level left the row green.
    const { commandsLog } = clickWith({
      status: -1,
      value: {
        error: 'timeout',
        message: 'Timed out while waiting for element "a*=Logout"',
        stack: 'Error at BrowserProxy.handleCommandExecution'
      }
    })
    expect((commandsLog[0].error as Error).message).toContain('Timed out')
    expect(commandsLog[0].result).toBeUndefined()
  })

  it('treats a thrown Error handed to the callback as the row error', () => {
    const { commandsLog } = clickWith(new Error('stale element reference'))
    expect((commandsLog[0].error as Error).message).toBe(
      'stale element reference'
    )
  })

  it('leaves a successful result untouched', () => {
    const { commandsLog } = clickWith({ value: null })
    expect(commandsLog[0].error).toBeUndefined()
  })

  it('does not reinterpret an assertion result as a command failure', () => {
    // An assertion result carries its own pass/fail handling.
    const { commandsLog } = clickWith({
      passed: false,
      error: 'assertion failed',
      message: 'nope'
    })
    expect(commandsLog[0].error).toBeUndefined()
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

describe('BrowserProxy native-assert buffer scope', () => {
  beforeEach(() => {
    getCallSourceFromStack.mockReset()
    getCallSourceFromStack.mockReturnValue({
      filePath: '/tests/steps.js',
      callSource: '/tests/steps.js:31'
    })
  })

  /** Browser whose assert method returns a promise the test controls, mirroring
   *  Nightwatch's ES6-async command return (`node.deferred.promise`). */
  function makeSettleableAssertBrowser() {
    const settlers: Array<{
      resolve: (v: unknown) => void
      reject: (e: unknown) => void
    }> = []
    const method = vi.fn(
      () =>
        new Promise<unknown>((resolve, reject) => {
          settlers.push({ resolve, reject })
        })
    )
    const browser = {
      assert: { urlContains: method },
      verify: { urlContains: method }
    } as unknown as NightwatchBrowser
    return { browser, settlers }
  }

  function assertNs(browser: NightwatchBrowser) {
    return (
      browser as unknown as {
        assert: { urlContains: (a: unknown) => unknown }
      }
    ).assert
  }

  it('survives a per-step resetCommandTracking (cucumber calls it between steps)', () => {
    const { capturer } = makeCapturer()
    const proxy = new BrowserProxy(capturer, makeTestManager(), () => ({
      uid: 'scenario-1'
    }))
    const { browser } = makeSettleableAssertBrowser()
    proxy.wrapBrowserCommands(browser)

    assertNs(browser).urlContains('/secure')
    // Cucumber resets dedup state at every BeforeStep. Clearing the assert
    // buffer there dropped every assertion but the last step's.
    proxy.resetCommandTracking()
    assertNs(browser).urlContains('/login')

    const calls = proxy.drainNativeAssertCalls()
    expect(calls.map((c) => c.args[0])).toEqual(['/secure', '/login'])
  })

  it('clears the buffer on resetTestTracking (a new test unit starts fresh)', () => {
    const { capturer } = makeCapturer()
    const proxy = new BrowserProxy(capturer, makeTestManager(), () => ({
      uid: 'scenario-1'
    }))
    const { browser } = makeSettleableAssertBrowser()
    proxy.wrapBrowserCommands(browser)

    assertNs(browser).urlContains('/secure')
    proxy.resetTestTracking()

    expect(proxy.drainNativeAssertCalls()).toEqual([])
  })

  it('records the outcome off the assertion promise for both settlements', async () => {
    const { capturer } = makeCapturer()
    const proxy = new BrowserProxy(capturer, makeTestManager(), () => ({
      uid: 'scenario-1'
    }))
    const { browser, settlers } = makeSettleableAssertBrowser()
    proxy.wrapBrowserCommands(browser)

    const okPromise = assertNs(browser).urlContains('/secure')
    const failPromise = assertNs(browser).urlContains('/nope')
    const calls = proxy.drainNativeAssertCalls()

    settlers[0].resolve('https://example.com/secure')
    settlers[1].reject(new Error('expected "/nope" but got: "/secure"'))
    await okPromise
    await expect(failPromise).rejects.toThrow('but got')

    expect(calls[0].observed?.passed).toBe(true)
    expect(calls[1].observed?.passed).toBe(false)
    expect(calls[1].observed?.message).toContain('but got')
  })

  it('leaves a non-thenable command return unobserved', () => {
    const { capturer } = makeCapturer()
    const proxy = new BrowserProxy(capturer, makeTestManager(), () => ({
      uid: 'scenario-1'
    }))
    // Nightwatch returns the `api` object (not a promise) when commands aren't
    // ES6-async; the results-bag path supplies the outcome there.
    const browser = {
      assert: { urlContains: vi.fn(() => browser) },
      verify: { urlContains: vi.fn(() => browser) }
    } as unknown as NightwatchBrowser
    proxy.wrapBrowserCommands(browser)

    assertNs(browser).urlContains('/secure')

    expect(proxy.drainNativeAssertCalls()[0].observed).toBeUndefined()
  })
})
