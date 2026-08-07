import { describe, it, expect, vi } from 'vitest'
import {
  captureNativeAssertions,
  latestResolvedScreenshot,
  observedAssertOutcome,
  pendingAssertionCommand
} from '../src/helpers/nativeAssertions.js'
import type { SessionCapturer } from '../src/session.js'
import type {
  CommandLog,
  NativeAssertCall,
  NightwatchBrowser,
  NightwatchCurrentTest
} from '../src/types.js'

/** Fake capturer mimicking the live stream: `captureAssertCommand` assigns a
 *  stable public `id` and appends to `commandsLog` (like the real one);
 *  `sendReplaceCommand` records in-place updates; `takeScreenshotViaHttp` is
 *  the fresh-fallback. */
function makeFakeCapturer(
  commandsLog: CommandLog[] = [],
  freshScreenshot: string | null = 'FRESH_SHOT'
) {
  const sent: CommandLog[] = []
  const replaced: Array<{ oldTimestamp: number; command: CommandLog }> = []
  let counter = 100
  const captureAssertCommand = vi.fn(
    (entry: CommandLog & { _id?: number; id?: number }) => {
      entry._id = counter++
      entry.id = entry._id
      commandsLog.push(entry)
      sent.push(entry)
    }
  )
  const sendReplaceCommand = vi.fn(
    (oldTimestamp: number, command: CommandLog) => {
      replaced.push({ oldTimestamp, command })
    }
  )
  const takeScreenshotViaHttp = vi.fn(() => Promise.resolve(freshScreenshot))
  const capturer = {
    commandsLog,
    captureAssertCommand,
    sendReplaceCommand,
    takeScreenshotViaHttp
  } as unknown as SessionCapturer
  return {
    capturer,
    commandsLog,
    sent,
    replaced,
    captureAssertCommand,
    sendReplaceCommand,
    takeScreenshotViaHttp
  }
}

const browser = {} as unknown as NightwatchBrowser

/** Mimic BrowserProxy.emitPendingAssertion: build the row and buffer it on the
 *  call, but do NOT stream it — rows are emitted at test-end by
 *  captureNativeAssertions once their pass/fail is known. */
function emitPending(
  capturer: SessionCapturer,
  calls: NativeAssertCall[],
  testUid: string | undefined
) {
  for (const call of calls) {
    call.entry = pendingAssertionCommand(
      call,
      testUid,
      latestResolvedScreenshot(capturer)
    )
  }
}

/** Nightwatch's `getAssertResult` entries: pass → `failure: false`; fail →
 *  `failure` is a message string. The message embeds the assertion args. */
function passing(message: string) {
  return { message, fullMsg: message, failure: false as const }
}
function failing(message: string) {
  return { message, fullMsg: message, failure: `${message} — failed` }
}

function currentTestWith(
  assertions: unknown[],
  commands: unknown[] = []
): NightwatchCurrentTest {
  return {
    name: 'renders asserts',
    module: 'assert-check',
    results: { assertions, commands }
  } as unknown as NightwatchCurrentTest
}

let clock = 1000
function call(
  prefix: 'assert' | 'verify',
  method: string,
  args: unknown[],
  callSource = 'spec.js:8'
): NativeAssertCall {
  return { prefix, method, args, callSource, timestamp: clock++ }
}

describe('captureNativeAssertions (buffer → finalize at test-end)', () => {
  it('buffers rows at call time (nothing streamed), then emits pass/fail once at test-end with no duplicates', async () => {
    // Preceding real commands: the last with a resolved screenshot is the DOM
    // the assertions evaluated against — reused for the pending rows.
    const precedingCommands: CommandLog[] = [
      { command: 'url', args: [], timestamp: 1, screenshot: 'URL_SHOT' },
      {
        command: 'waitForElementVisible',
        args: ['body'],
        timestamp: 2,
        screenshot: 'BODY_SHOT'
      }
    ]
    const {
      capturer,
      sent,
      commandsLog,
      captureAssertCommand,
      sendReplaceCommand,
      takeScreenshotViaHttp
    } = makeFakeCapturer(precedingCommands)
    const calls = [
      call('verify', 'titleContains', ['Example'], 'spec.js:11'),
      call('verify', 'titleContains', ['SOFT_FAIL_ME'], 'spec.js:12'),
      call('assert', 'titleContains', ['Example'], 'spec.js:15'),
      call('assert', 'titleContains', ['HARD_FAIL_ME'], 'spec.js:16')
    ]

    // 1) CALL TIME: rows are buffered, NOT streamed — nothing is sent, so no
    // assert shows as a neutral (green) row before its outcome is known.
    emitPending(capturer, calls, 'test-uid')
    expect(captureAssertCommand).not.toHaveBeenCalled()
    expect(sent).toHaveLength(0)
    const buffered = calls.map((c) => c.entry!)
    for (const row of buffered) {
      expect(row.result).toBeUndefined() // neutral — not green
      expect(row.error).toBeUndefined() // neutral — not red
      expect(row.testUid).toBe('test-uid')
      expect(row.screenshot).toBe('BODY_SHOT') // reused preceding DOM
    }
    expect(buffered[0].title).toBe("verify.titleContains('Example')")
    expect(buffered[0].command).toBe('verify.titleContains')
    expect(buffered[0].args).toEqual(['Example'])
    expect(buffered[0].callSource).toBe('spec.js:11')
    expect(buffered[0].timestamp).toBe(buffered[0].startTime)

    // 2) TEST END: results.assertions includes the implicit waitForElementVisible
    // assertion (first entry) which must NOT create/finalize a row.
    const assertions = [
      passing('Element <body> was visible after 16 milliseconds'),
      passing("Testing if the page title contains 'Example'"),
      failing("Testing if the page title contains 'SOFT_FAIL_ME'"),
      passing("Testing if the page title contains 'Example'"),
      failing("Testing if the page title contains 'HARD_FAIL_ME'")
    ]
    await captureNativeAssertions(
      capturer,
      browser,
      currentTestWith(assertions),
      'test-uid',
      calls
    )

    // Rows emitted exactly once at test-end — no call-time stream, no replace.
    expect(captureAssertCommand).toHaveBeenCalledTimes(4)
    expect(sendReplaceCommand).not.toHaveBeenCalled()
    expect(sent).toHaveLength(4)
    expect(commandsLog).toHaveLength(2 + 4)
    expect(takeScreenshotViaHttp).not.toHaveBeenCalled()

    const finalized = calls.map((c) => c.entry!)

    // Pass/fail applied as a collapsed { passed, expected, actual? } result;
    // failures also carry the verbose message as error.
    expect(finalized[0].result).toMatchObject({ passed: true })
    expect(finalized[0].error).toBeUndefined()
    expect(finalized[1].result).toMatchObject({ passed: false })
    expect((finalized[1].error as { message: string }).message).toContain(
      'SOFT_FAIL_ME'
    )
    expect(finalized[2].result).toMatchObject({ passed: true }) // 2nd 'Example'
    expect(finalized[3].error).toBeDefined()

    // Labels/args/callSource preserved from the pending row.
    expect(finalized[3].title).toBe("assert.titleContains('HARD_FAIL_ME')")
    expect(finalized[3].callSource).toBe('spec.js:16')

    // With no results.commands timing, rows keep their call-time timestamp.
    finalized.forEach((row) => {
      expect(row.timestamp).toBe(row.startTime)
    })
  })

  it('repositions each row on its real execution window from results.commands (not enqueue time)', async () => {
    const { capturer, sent } = makeFakeCapturer()
    const calls = [
      call('verify', 'titleContains', ['Example']),
      call('assert', 'titleContains', ['SOFT_FAIL_ME'])
    ]
    emitPending(capturer, calls, 'uid')
    // Buffered ~together (clock++), clustered at call time — nothing sent yet.
    expect(sent).toHaveLength(0)

    // Nightwatch ran them ~29ms apart; results.commands carries the real window.
    const assertions = [
      passing("Testing if the page title contains 'Example'"),
      failing("Testing if the page title contains 'SOFT_FAIL_ME'")
    ]
    const commands = [
      { name: 'url', startTime: 5000, endTime: 5100 },
      { name: 'verify.titleContains', startTime: 6000, endTime: 6029 },
      { name: 'assert.titleContains', startTime: 6100, endTime: 6132 }
    ]
    await captureNativeAssertions(
      capturer,
      browser,
      currentTestWith(assertions, commands),
      'uid',
      calls
    )

    const finalized = calls.map((c) => c.entry!)
    // startTime/timestamp now reflect the real execution window, spread apart.
    expect(finalized[0].startTime).toBe(6000)
    expect(finalized[0].timestamp).toBe(6029)
    expect(finalized[1].startTime).toBe(6100)
    expect(finalized[1].timestamp).toBe(6132)
    expect(finalized[1].timestamp - finalized[0].timestamp).toBeGreaterThan(50)
    // Rows are sent (not replaced) at test-end, each carrying its real window.
    expect(sent).toHaveLength(2)
    expect(sent[0].timestamp).toBe(6029)
    expect(sent[1].timestamp).toBe(6132)
  })

  it('finalizes with a fresh screenshot when no preceding one has resolved yet', async () => {
    // Race: preceding capture is fire-and-forget and unresolved → pending rows
    // stream without a screenshot; finalize takes a fresh end-of-test one.
    const pending: CommandLog[] = [
      { command: 'waitForElementVisible', args: ['body'], timestamp: 2 }
    ]
    const { capturer, takeScreenshotViaHttp } = makeFakeCapturer(
      pending,
      'FRESH_SHOT'
    )
    const calls = [call('verify', 'titleContains', ['Example'])]
    emitPending(capturer, calls, 'uid')
    expect(calls[0].entry!.screenshot).toBeUndefined()

    await captureNativeAssertions(
      capturer,
      browser,
      currentTestWith([
        passing("Testing if the page title contains 'Example'")
      ]),
      'uid',
      calls
    )
    expect(takeScreenshotViaHttp).toHaveBeenCalledTimes(1)
    expect(calls[0].entry!.screenshot).toBe('FRESH_SHOT')
    expect(calls[0].entry!.result).toMatchObject({ passed: true })
  })

  it('preserves real multi-arg assertions (no faked args)', async () => {
    const { capturer, sent } = makeFakeCapturer()
    const calls = [call('assert', 'containsText', ['#btn', 'Save'])]
    emitPending(capturer, calls, 'uid')
    expect(calls[0].entry!.args).toEqual(['#btn', 'Save'])
    expect(calls[0].entry!.title).toBe("assert.containsText('#btn', 'Save')")

    await captureNativeAssertions(
      capturer,
      browser,
      currentTestWith([
        failing("Testing if element <#btn> contains text 'Save'")
      ]),
      'uid',
      calls
    )
    expect(sent).toHaveLength(1)
    expect(calls[0].entry!.error).toBeDefined()
  })

  it('falls back to positional correlation when args are not literals', async () => {
    const { capturer } = makeFakeCapturer()
    // Element-object arg won't substring-match; positional order still pairs
    // the single call with the single explicit assertion outcome.
    const calls = [call('assert', 'elementPresent', [{ selector: 'body' }])]
    emitPending(capturer, calls, 'uid')
    expect(calls[0].entry!.title).toBe('assert.elementPresent(…)')

    await captureNativeAssertions(
      capturer,
      browser,
      currentTestWith([failing('Testing if element <body> is present')]),
      'uid',
      calls
    )
    expect(calls[0].entry!.error).toBeDefined()
  })

  it('leaves an uncorrelated pending row in its neutral state (defensive)', async () => {
    const { capturer, sent, sendReplaceCommand } = makeFakeCapturer()
    const calls = [call('assert', 'ok', [true])]
    emitPending(capturer, calls, 'uid')
    // No matching results entry — row must not be dropped or mis-coloured.
    await captureNativeAssertions(
      capturer,
      browser,
      currentTestWith([]),
      'uid',
      calls
    )
    expect(sent).toHaveLength(1)
    expect(sendReplaceCommand).not.toHaveBeenCalled()
    expect(calls[0].entry!.result).toBeUndefined()
    expect(calls[0].entry!.error).toBeUndefined()
  })

  it('surfaces a real actual-vs-expected from the failure message (not the expected-only arg)', async () => {
    const { capturer, sent } = makeFakeCapturer()
    const calls = [call('assert', 'titleContains', ['This Is Not The Title'])]
    emitPending(capturer, calls, 'uid')

    await captureNativeAssertions(
      capturer,
      browser,
      currentTestWith([
        failing(
          "Testing if the page title contains 'This Is Not The Title' in " +
            '5000ms - expected "contains \'This Is Not The Title\'" but got: ' +
            '"Example Domain"'
        )
      ]),
      'uid',
      calls
    )

    // Nightwatch passes only the EXPECTED as an arg; the real actual lives in
    // the "but got: …" clause of the message. The collapsed result must carry
    // the true diff, not mislabel the expected arg as the actual.
    const result = sent[0].result as {
      passed: boolean
      expected: unknown
      actual: unknown
    }
    expect(result.passed).toBe(false)
    expect(result.expected).toBe('This Is Not The Title')
    expect(result.actual).toBe('Example Domain')
  })

  it('is a no-op when there are no recorded calls (implicit assertions ignored)', async () => {
    const { capturer, sendReplaceCommand, takeScreenshotViaHttp } =
      makeFakeCapturer()
    await captureNativeAssertions(
      capturer,
      browser,
      currentTestWith([passing('Element <body> was visible')]),
      'uid',
      []
    )
    expect(sendReplaceCommand).not.toHaveBeenCalled()
    expect(takeScreenshotViaHttp).not.toHaveBeenCalled()
  })
})

describe('observedAssertOutcome (settlement of the assertion promise)', () => {
  it('reads a rejection as a failure with the ANSI-stripped message', () => {
    const err = new Error(
      "[31mTesting if the page title contains 'NOPE'[39m - " +
        'expected "contains \'NOPE\'" but got: "The Internet"'
    )
    expect(
      observedAssertOutcome({ rejected: true, value: err, settledAt: 7 })
    ).toEqual({
      passed: false,
      message:
        "Testing if the page title contains 'NOPE' - expected " +
        '"contains \'NOPE\'" but got: "The Internet"',
      settledAt: 7
    })
  })

  it('reads a fulfilment WITH an Error as a failure — the non-aborting verify path', () => {
    // `verify.*` does not abort the queue, so Nightwatch resolves the node with
    // the AssertionError rather than rejecting it (lib/core/asynctree.js).
    const outcome = observedAssertOutcome({
      rejected: false,
      value: new Error('verify failed - expected "x" but got: "y"'),
      settledAt: 9
    })
    expect(outcome?.passed).toBe(false)
    expect(outcome?.message).toBe('verify failed - expected "x" but got: "y"')
  })

  it('reads a fulfilment with a value as a pass and carries no message', () => {
    expect(
      observedAssertOutcome({
        rejected: false,
        value: 'https://example.com/secure',
        settledAt: 3
      })
    ).toEqual({ passed: true, message: '', settledAt: 3 })
  })

  it('treats a falsy-but-defined fulfilment as a pass', () => {
    // A passing assertion can resolve with `null`/`false` (the unwrapped W3C
    // `value`); only `undefined` means the node never ran.
    expect(
      observedAssertOutcome({ rejected: false, value: null, settledAt: 1 })
        ?.passed
    ).toBe(true)
    expect(
      observedAssertOutcome({ rejected: false, value: false, settledAt: 1 })
        ?.passed
    ).toBe(true)
  })

  it('returns no outcome for an undefined fulfilment (assertion never executed)', () => {
    // An `assert.*` failure empties the queue; every assertion still enqueued
    // then has its deferred resolved with the unset `node.resolveValue`. Reading
    // that as a pass would paint a never-run assertion green.
    expect(
      observedAssertOutcome({
        rejected: false,
        value: undefined,
        settledAt: 5
      })
    ).toBeUndefined()
  })
})

describe('captureNativeAssertions with no results bag (cucumber runner)', () => {
  /** The cucumber runner builds its Nightwatch client with no reporter, so
   *  `SimplifiedReporter.logAssertResult` no-ops and there is no results bag at
   *  all — `currentTest` is undefined and `correlate` has nothing to read. */
  it('colours rows from the observed settlement instead of the results bag', async () => {
    const { capturer, sent } = makeFakeCapturer()
    const calls = [
      call('assert', 'urlContains', ['/secure'], 'steps.js:31'),
      call('assert', 'titleContains', ['NOPE'], 'steps.js:32')
    ]
    emitPending(capturer, calls, 'scenario-uid')
    calls[0].observed = {
      passed: true,
      message: '',
      settledAt: calls[0].timestamp + 146
    }
    calls[1].observed = {
      passed: false,
      message:
        "Testing if the page title contains 'NOPE' - expected \"contains " +
        '\'NOPE\'" but got: "The Internet"',
      settledAt: calls[1].timestamp + 5072
    }

    await captureNativeAssertions(capturer, browser, undefined, 'uid', calls)

    expect(sent).toHaveLength(2)
    expect(sent[0].result).toEqual({ passed: true, expected: '/secure' })
    expect(sent[0].error).toBeUndefined()
    // Passing rows carry no prose (a settlement has none) — omitted, not blank.
    expect(sent[0].result).not.toHaveProperty('message')
    const failed = sent[1].result as {
      passed: boolean
      expected: unknown
      actual: unknown
    }
    expect(failed.passed).toBe(false)
    expect(failed.expected).toBe('NOPE')
    // `actual` still comes from the "but got: …" clause, as on the BDD path.
    expect(failed.actual).toBe('The Internet')
    expect(sent[1].error?.message).toContain('but got')
  })

  it('spans each row over its observed execution window instead of a synthetic 1 ms', async () => {
    const { capturer, sent } = makeFakeCapturer()
    const calls = [call('assert', 'urlContains', ['/secure'])]
    emitPending(capturer, calls, 'scenario-uid')
    const enqueued = calls[0].timestamp
    calls[0].observed = { passed: true, message: '', settledAt: enqueued + 146 }

    await captureNativeAssertions(capturer, browser, undefined, 'uid', calls)

    expect(sent[0].startTime).toBe(enqueued)
    expect(sent[0].timestamp).toBe(enqueued + 146)
  })

  it('leaves a row neutral when the settlement carried no outcome', async () => {
    const { capturer, sent } = makeFakeCapturer()
    const calls = [call('assert', 'urlContains', ['/secure'])]
    emitPending(capturer, calls, 'scenario-uid')

    await captureNativeAssertions(capturer, browser, undefined, 'uid', calls)

    expect(sent).toHaveLength(1)
    expect(sent[0].result).toBeUndefined()
    expect(sent[0].error).toBeUndefined()
  })

  it('keeps the results-bag outcome and its enqueue timestamp when both sources exist', async () => {
    // The BDD interface reports no per-assertion command window, so a correlated
    // row must keep its enqueue timestamp — `sequence` ordering depends on the
    // resulting tie. The settlement must not quietly reposition it.
    const { capturer, sent } = makeFakeCapturer()
    const calls = [call('assert', 'titleContains', ['Example'])]
    emitPending(capturer, calls, 'uid')
    const enqueued = calls[0].timestamp
    calls[0].observed = {
      passed: false,
      message: 'settlement says failed',
      settledAt: enqueued + 500
    }

    await captureNativeAssertions(
      capturer,
      browser,
      currentTestWith([
        passing("Testing if the page title contains 'Example'")
      ]),
      'uid',
      calls
    )

    expect((sent[0].result as { passed: boolean }).passed).toBe(true)
    expect(sent[0].timestamp).toBe(enqueued)
  })
})
