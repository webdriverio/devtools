import { describe, it, expect, vi } from 'vitest'
import {
  captureNativeAssertions,
  latestResolvedScreenshot,
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

/** Mimic BrowserProxy.emitPendingAssertion: stream a neutral pending row at
 *  call time and attach it to the call for later finalization. */
function emitPending(
  capturer: SessionCapturer,
  calls: NativeAssertCall[],
  testUid: string | undefined
) {
  for (const call of calls) {
    const entry = pendingAssertionCommand(
      call,
      testUid,
      latestResolvedScreenshot(capturer)
    )
    capturer.captureAssertCommand(entry)
    call.entry = entry
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

describe('captureNativeAssertions (live pending → finalize)', () => {
  it('streams neutral pending rows at call time, then finalizes pass/fail in place with a stable id and no duplicates', async () => {
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
      replaced,
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

    // 1) CALL TIME: each call streams one neutral pending row.
    emitPending(capturer, calls, 'test-uid')
    expect(captureAssertCommand).toHaveBeenCalledTimes(4)
    expect(sent).toHaveLength(4)
    for (const row of sent) {
      expect(row.result).toBeUndefined() // neutral — not green
      expect(row.error).toBeUndefined() // neutral — not red
      expect(row.testUid).toBe('test-uid')
      expect(row.screenshot).toBe('BODY_SHOT') // reused preceding DOM
      expect(typeof (row as { id?: number }).id).toBe('number')
    }
    expect(sent[0].title).toBe("verify.titleContains('Example')")
    expect(sent[0].command).toBe('verify.titleContains')
    expect(sent[0].args).toEqual(['Example'])
    expect(sent[0].callSource).toBe('spec.js:11')
    expect(sent[0].timestamp).toBe(sent[0].startTime)
    const pendingIds = sent.map((r) => (r as { id?: number }).id)

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

    // Each row updated exactly once, in place — no new rows, no duplicates.
    expect(captureAssertCommand).toHaveBeenCalledTimes(4)
    expect(sendReplaceCommand).toHaveBeenCalledTimes(4)
    expect(commandsLog).toHaveLength(2 + 4)
    expect(takeScreenshotViaHttp).not.toHaveBeenCalled()

    // Same row objects, same stable ids (updated, not recreated).
    const finalized = calls.map((c) => c.entry!)
    expect(finalized.map((r) => (r as { id?: number }).id)).toEqual(pendingIds)

    // Pass/fail applied; failures carry the verbose message as error.
    expect(finalized[0].result).toBe('passed')
    expect(finalized[0].error).toBeUndefined()
    expect(finalized[1].result).toBeUndefined()
    expect((finalized[1].error as { message: string }).message).toContain(
      'SOFT_FAIL_ME'
    )
    expect(finalized[2].result).toBe('passed') // duplicate 'Example' → 2nd entry
    expect(finalized[3].error).toBeDefined()

    // Labels/args/callSource preserved from the pending row.
    expect(finalized[3].title).toBe("assert.titleContains('HARD_FAIL_ME')")
    expect(finalized[3].callSource).toBe('spec.js:16')

    // With no results.commands timing, rows keep their enqueue timestamp, so
    // the replace is keyed on that same timestamp.
    replaced.forEach(({ oldTimestamp, command }) => {
      expect(oldTimestamp).toBe(command.timestamp)
    })
  })

  it('repositions each row on its real execution window from results.commands (not enqueue time)', async () => {
    const { capturer, sent, replaced } = makeFakeCapturer()
    const calls = [
      call('verify', 'titleContains', ['Example']),
      call('assert', 'titleContains', ['SOFT_FAIL_ME'])
    ]
    emitPending(capturer, calls, 'uid')
    // Both enqueued ~together (clock++), clustered.
    const enqueue = sent.map((r) => r.timestamp)

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
    // The replace is keyed on the ORIGINAL enqueue timestamp (stable id also
    // matches), while the row now carries its real execution timestamp.
    expect(replaced[0].oldTimestamp).toBe(enqueue[0])
    expect(replaced[0].command.timestamp).toBe(6029)
  })

  it('finalizes with a fresh screenshot when no preceding one has resolved yet', async () => {
    // Race: preceding capture is fire-and-forget and unresolved → pending rows
    // stream without a screenshot; finalize takes a fresh end-of-test one.
    const pending: CommandLog[] = [
      { command: 'waitForElementVisible', args: ['body'], timestamp: 2 }
    ]
    const { capturer, sent, takeScreenshotViaHttp } = makeFakeCapturer(
      pending,
      'FRESH_SHOT'
    )
    const calls = [call('verify', 'titleContains', ['Example'])]
    emitPending(capturer, calls, 'uid')
    expect(sent[0].screenshot).toBeUndefined()

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
    expect(calls[0].entry!.result).toBe('passed')
  })

  it('preserves real multi-arg assertions (no faked args)', async () => {
    const { capturer, sent, replaced } = makeFakeCapturer()
    const calls = [call('assert', 'containsText', ['#btn', 'Save'])]
    emitPending(capturer, calls, 'uid')
    expect(sent[0].args).toEqual(['#btn', 'Save'])
    expect(sent[0].title).toBe("assert.containsText('#btn', 'Save')")

    await captureNativeAssertions(
      capturer,
      browser,
      currentTestWith([
        failing("Testing if element <#btn> contains text 'Save'")
      ]),
      'uid',
      calls
    )
    expect(replaced).toHaveLength(1)
    expect(calls[0].entry!.error).toBeDefined()
  })

  it('falls back to positional correlation when args are not literals', async () => {
    const { capturer, sent } = makeFakeCapturer()
    // Element-object arg won't substring-match; positional order still pairs
    // the single call with the single explicit assertion outcome.
    const calls = [call('assert', 'elementPresent', [{ selector: 'body' }])]
    emitPending(capturer, calls, 'uid')
    expect(sent[0].title).toBe('assert.elementPresent(…)')

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
