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
  // Captures run in issue order, so the wait's own row already has its id when a row its condition issued arrives.
  const parentId = cmd.waitScope?.rowId
  if (parentId !== undefined) {
    entry.parentId = parentId
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
export function captureOrReplaceCommand(opts: {
  capturer: SessionCapturer
  retryTracker: RetryTracker
  test: TestStats
  cmd: CapturedCommand
}): Promise<CommandLog & { _id?: number }> {
  // One capture at a time per capturer. The driver patcher does not await
  // `onCommand`, so a `wait()` poll arrives while the previous poll's capture
  // is still awaiting its id, finds no row recorded on its wait to fold into,
  // and lands as a second row instead of folding into the first.
  const previous = queues.get(opts.capturer) ?? Promise.resolve()
  const next = previous
    .catch(() => undefined)
    .then(() => captureOrReplaceSerially(opts))
  queues.set(opts.capturer, next)
  return next
}

const queues = new WeakMap<SessionCapturer, Promise<unknown>>()

async function captureOrReplaceSerially(opts: {
  capturer: SessionCapturer
  retryTracker: RetryTracker
  test: TestStats
  cmd: CapturedCommand
}): Promise<CommandLog & { _id?: number }> {
  const { capturer, retryTracker, test, cmd } = opts
  const error = cmd.error ? toError(cmd.error) : undefined
  const cmdSig = RetryTracker.signature(cmd.command, cmd.args, cmd.callSource)
  const ofWait = cmd.waitScope !== undefined || cmd.wait !== undefined
  if (ofWait) {
    // A wait's rows fold by scope and never enter the retry tracker, so no later retry can land on one; nor does a retry fold across a wait.
    retryTracker.reset()
  }
  const targetId = cmd.wait
    ? // A wait's row is replaced by its settling, and a nested wait's by its next call on a later outer poll.
      cmd.wait.rowId
    : cmd.waitScope
      ? // A wait's poll folds only into the row an earlier poll made for the same call.
        cmd.waitScope.rows.get(cmd.pollKey ?? '')
      : retryTracker.isRetry(cmdSig)
        ? retryTracker.lastId!
        : undefined

  if (targetId !== undefined) {
    const entry = replaceRow(opts, targetId, error)
    if (!ofWait) {
      retryTracker.setLastId(entry._id ?? null)
    }
    noteWaitRows(cmd, entry)
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
  if (!ofWait) {
    retryTracker.recordCapture(cmdSig, entry._id ?? null)
  }
  noteWaitRows(cmd, entry)
  return entry
}

function replaceRow(
  opts: { capturer: SessionCapturer; test: TestStats; cmd: CapturedCommand },
  targetId: number,
  error: Error | undefined
): CommandLog & { _id?: number } {
  const { capturer, test, cmd } = opts
  const previous = capturer.commandsLog.find(
    (row) => (row as CommandLog & { _id?: number })._id === targetId
  )
  const replaced = capturer.replaceCommand(
    targetId,
    cmd.command,
    cmd.args.map((a: unknown) => a),
    error ? undefined : cmd.result,
    error,
    test.uid,
    cmd.callSource ?? previous?.callSource,
    cmd.timestamp
  )
  const entry = replaced.entry as CommandLog & { _id?: number }
  applyCapturedFields(entry, cmd)
  capturer.sendReplaceCommand(replaced.oldTimestamp, entry)
  return entry
}

function noteWaitRows(
  cmd: CapturedCommand,
  entry: CommandLog & { _id?: number }
): void {
  if (entry._id === undefined) {
    return
  }
  if (cmd.wait) {
    cmd.wait.rowId = entry._id
  }
  if (cmd.waitScope && cmd.pollKey) {
    cmd.waitScope.rows.set(cmd.pollKey, entry._id)
  }
}
