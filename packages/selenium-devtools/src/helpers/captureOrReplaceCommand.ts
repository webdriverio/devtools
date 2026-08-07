import { RetryTracker, toError } from '@wdio/devtools-core'
import type { SessionCapturer } from '../session.js'
import type { CapturedCommand, CommandLog, TestStats } from '../types.js'

/** Fields the capturer's positional API doesn't carry. An absent `selector`
 *  leaves the previous one standing: `replaceCommand` mutates the row in place,
 *  so a retry must not blank the locator its first attempt resolved. */
function applyCapturedFields(entry: CommandLog, cmd: CapturedCommand): void {
  entry.startTime = cmd.startTime
  if (cmd.selector) {
    entry.selector = cmd.selector
  }
}

/**
 * Capture (or replace, on a detected retry) a single CapturedCommand into the
 * SessionCapturer's command log. Returns the resulting CommandLog entry with
 * its internal `_id` so the caller can attach deferred async data (screenshots,
 * trace results) and broadcast a replace later.
 *
 * Extracted from `SeleniumDevToolsPlugin.onCommand` — the retry-vs-fresh
 * branching was the densest section of that 73-line method and is pure logic
 * given a capturer + retry tracker + test handle.
 */
export async function captureOrReplaceCommand(opts: {
  capturer: SessionCapturer
  retryTracker: RetryTracker
  test: TestStats
  cmd: CapturedCommand
}): Promise<CommandLog & { _id?: number }> {
  const { capturer, retryTracker, test, cmd } = opts
  const error = cmd.error ? toError(cmd.error) : undefined
  const cmdSig = RetryTracker.signature(cmd.command, cmd.args, cmd.callSource)

  if (retryTracker.isRetry(cmdSig)) {
    const replaced = capturer.replaceCommand(
      retryTracker.lastId!,
      cmd.command,
      cmd.args.map((a: unknown) => a),
      error ? undefined : cmd.result,
      error,
      test.uid,
      cmd.callSource,
      cmd.timestamp
    )
    const entry = replaced.entry as CommandLog & { _id?: number }
    applyCapturedFields(entry, cmd)
    retryTracker.setLastId(entry._id ?? null)
    capturer.sendReplaceCommand(replaced.oldTimestamp, entry)
    return entry
  }

  const entry = (await capturer.captureCommand(
    cmd.command,
    cmd.args,
    cmd.result,
    error,
    test.uid,
    cmd.callSource,
    cmd.timestamp
  )) as CommandLog & { _id?: number }
  applyCapturedFields(entry, cmd)
  capturer.sendCommand(entry)
  retryTracker.recordCapture(cmdSig, entry._id ?? null)
  return entry
}
