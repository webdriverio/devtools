/**
 * Call-time recorder for explicit `browser.assert.*` / `browser.verify.*`.
 *
 * Extracted from BrowserProxy: the recording Proxy, the per-test buffer and the
 * settlement observation are one concern (getting a native assertion's args,
 * source location and outcome), separate from driver-command interception.
 * `nativeAssertions.ts` consumes the drained buffer at test-end.
 */

import {
  observedAssertOutcome,
  latestResolvedScreenshot,
  pendingAssertionCommand
} from './nativeAssertions.js'
import { getCallSourceFromStack } from './utils.js'
import type { SessionCapturer } from '../session.js'
import type { NativeAssertCall, NightwatchBrowser } from '../types.js'

export class NativeAssertRecorder {
  /**
   * Per-test-unit buffer of recorded calls. Nightwatch exposes no per-assertion
   * hook and its test-end results carry no source location for passing
   * assertions, so call-time capture is the only way to get real args +
   * callSource. Drained once per test unit (`afterEach`, or the cucumber
   * scenario's pre-quit hook) — never per step.
   */
  private calls: NativeAssertCall[] = []

  constructor(
    private readonly capturer: SessionCapturer,
    private getCurrentTest: () => { uid?: string } | null,
    private nextSequence: () => number
  ) {}

  clear(): void {
    this.calls = []
  }

  /** Hand off this test's recorded calls and clear the buffer so the next test
   *  unit starts fresh. */
  drain(): NativeAssertCall[] {
    const calls = this.calls
    this.calls = []
    return calls
  }

  /**
   * Replace `browser.assert` / `browser.verify` (both are Nightwatch Proxies
   * whose `get` returns a fresh function per access) with a recording Proxy:
   * on each method call it captures `{prefix, method, args, callSource}` from a
   * user-code frame, buffers a pending row, then delegates to the ORIGINAL
   * namespace method so Nightwatch's queue, chaining, and abortOnFailure
   * semantics (assert aborts, verify does not) are byte-for-byte unchanged.
   * Called once per browser.
   */
  wrapNamespaces(browser: NightwatchBrowser): void {
    // Cast once: the assert/verify namespaces aren't on the public type; each
    // is a dynamic method bag reached by property name.
    const b = browser as unknown as Record<string, unknown>
    ;(['assert', 'verify'] as const).forEach((prefix) => {
      const original = b[prefix]
      if (!original || typeof original !== 'object') {
        return
      }
      b[prefix] = this.namespaceProxy(original, prefix, [])
    })
  }

  /**
   * Recording Proxy over one assert/verify namespace. A function property
   * becomes a call-time recorder keyed by its full dotted path
   * (`titleContains`, `not.titleContains`); a nested namespace object recurses
   * through the SAME wrapper — Nightwatch exposes `assert.not` as its own Proxy,
   * so negated asserts are recorded via the identical mechanism as positive
   * ones instead of a parallel path. Non-method, non-namespace props pass
   * through untouched.
   */
  private namespaceProxy(
    target: object,
    prefix: 'assert' | 'verify',
    path: readonly string[]
  ): object {
    return new Proxy(target, {
      get: (t, name, receiver) => {
        const orig = Reflect.get(t, name, receiver)
        if (typeof name !== 'string') {
          return orig
        }
        if (orig !== null && typeof orig === 'object') {
          return this.namespaceProxy(orig, prefix, [...path, name])
        }
        if (typeof orig !== 'function') {
          return orig
        }
        return (...args: unknown[]) => {
          const callInfo = getCallSourceFromStack()
          const call =
            callInfo.filePath === undefined
              ? undefined
              : this.buffer({
                  prefix,
                  method: [...path, name].join('.'),
                  args,
                  callSource: callInfo.callSource,
                  timestamp: Date.now()
                })
          const result = (orig as (...a: unknown[]) => unknown)(...args)
          if (call) {
            this.observe(call, result)
          }
          return result
        }
      }
    })
  }

  /** Buffer an explicit assert/verify call at invocation time (prebuilding its
   *  row with args/callSource/screenshot), but do NOT stream it yet. Nightwatch
   *  exposes no per-assertion result hook, so streaming here would show every
   *  assert as a neutral (green) row while the test is still Running — before
   *  its pass/fail is known. `captureNativeAssertions` emits the rows at
   *  test-end with real outcomes + execution timing instead. */
  private buffer(call: NativeAssertCall): NativeAssertCall {
    const entry = pendingAssertionCommand(
      call,
      this.getCurrentTest()?.uid,
      latestResolvedScreenshot(this.capturer)
    )
    entry.sequence = this.nextSequence()
    call.entry = entry
    this.calls.push(call)
    return call
  }

  /**
   * Watch the assertion's OWN returned promise for its outcome — see
   * `observedAssertOutcome` for the settlement semantics and why this is the
   * cucumber runner's only pass/fail source. `result` is handed back to the
   * caller untouched; this only adds a second handler, so Nightwatch's own
   * chaining and rejection propagation are unchanged. A non-thenable result
   * (Nightwatch's synchronous `api` return, when commands aren't ES6-async)
   * leaves the call unobserved and the results-bag path supplies the outcome.
   */
  private observe(call: NativeAssertCall, result: unknown): void {
    const thenable = result as { then?: unknown } | null | undefined
    if (!thenable || typeof thenable.then !== 'function') {
      return
    }
    void (result as Promise<unknown>).then(
      (value) => {
        call.observed = observedAssertOutcome({
          rejected: false,
          value,
          settledAt: Date.now()
        })
      },
      (reason) => {
        call.observed = observedAssertOutcome({
          rejected: true,
          value: reason,
          settledAt: Date.now()
        })
      }
    )
  }
}
