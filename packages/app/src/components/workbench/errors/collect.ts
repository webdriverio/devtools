/**
 * Pure error-collection for the workbench Errors tab. Merges failed commands
 * (from `commandContext`) with failed tests (from `suiteContext`) into a single
 * ordered, de-duplicated list. Kept framework-free and side-effect-free so the
 * tab component only has to render what this returns.
 */

import type { CommandLog } from '@wdio/devtools-shared'
import type {
  SuiteStatsFragment,
  TestStatsFragment
} from '../../../controller/types.js'
import { stripAnsi } from '../console-filter.js'

/** One row in the Errors tab. */
export interface CollectedError {
  /** Failing action/step or test title — the row heading. */
  title: string
  /** Error message shown message-first, monospace. */
  message: string
  /** Optional stack, rendered under the message when present. */
  stack?: string
  /** `file:line:col` source anchor for the "open source" link. */
  callSource?: string
  /** The failing command, when the error came from one — lets the tab dispatch
   *  `show-command` to select and scroll to that action. */
  command?: CommandLog
  /** Command timestamp; drives ordering and the `show-command` elapsed time. */
  timestamp?: number
  /** Assertion expected value, rendered as a labelled row when present. */
  expected?: string
  /** Assertion received/actual value, rendered as a labelled row when present. */
  actual?: string
}

const ASSERTION_COMMAND_RE = /^(expect|assert|verify)\./

/** Display string for an expected/actual value that may already be serialized. */
function displayValue(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined
  }
  if (typeof value === 'string') {
    return value
  }
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

/** Assertion commands carry `[actual, expected]` in args (see the exporter's
 *  Assert params + synthesizeExpectFailure). */
function assertionValues(command: CommandLog): {
  actual?: string
  expected?: string
} {
  if (!ASSERTION_COMMAND_RE.test(command.command) || command.args.length < 2) {
    return {}
  }
  return {
    actual: displayValue(command.args[0]),
    expected: displayValue(command.args[1])
  }
}

interface ReadableError {
  message?: string
  name?: string
  stack?: string
  expected?: unknown
  actual?: unknown
}

/** Split trailing `at …` stack-frame lines off the message body. */
function splitStack(clean: string): { body: string; stack?: string } {
  const lines = clean.split('\n')
  const idx = lines.findIndex((line) => /^\s*at\s/.test(line))
  if (idx === -1) {
    return { body: clean.trimEnd() }
  }
  return {
    body: lines.slice(0, idx).join('\n').trimEnd(),
    stack: lines.slice(idx).join('\n').trim()
  }
}

/** Trim each line and drop blanks — assertion libraries indent continuation
 *  lines, which would otherwise show as ragged whitespace. */
function dedent(text: string): string {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n')
}

/** Pull `Expected:` / `Received:` values out of a matcher body and return the
 *  remaining headline. The labels may be indented (expect-webdriverio pads
 *  them), and `Received:` can span several lines up to the end of the body. */
function extractDiff(body: string): {
  headline: string
  expected?: string
  actual?: string
} {
  const expected = body.match(/^[ \t]*Expected:[ \t]*(.*)$/m)?.[1]?.trim()
  const receivedAt = body.search(/^[ \t]*Received:/m)
  let actual: string | undefined
  let headline = body
  if (receivedAt !== -1) {
    actual = dedent(
      body.slice(receivedAt).replace(/^[ \t]*Received:[ \t]*/, '')
    )
    headline = body.slice(0, receivedAt)
  }
  if (expected !== undefined) {
    headline = headline.replace(/^[ \t]*Expected:[ \t]*.*$/m, '')
  }
  return { headline: dedent(headline), expected, actual }
}

/** Clean, structured view of any error-ish value: ANSI stripped, stack split
 *  off the message, and assertion Expected/Received pulled into fields. */
function readError(error: unknown):
  | {
      message: string
      stack?: string
      expected?: string
      actual?: string
    }
  | undefined {
  if (!error || typeof error !== 'object') {
    return undefined
  }
  const e = error as ReadableError
  const raw = e.message?.trim() || e.name?.trim() || ''
  if (!raw && !e.stack) {
    return undefined
  }
  const { body, stack } = splitStack(stripAnsi(raw))
  const diff = extractDiff(body)
  return {
    message: diff.headline || 'Error',
    stack: e.stack ? stripAnsi(e.stack) : stack,
    expected: diff.expected ?? displayValue(e.expected),
    actual: diff.actual ?? displayValue(e.actual)
  }
}

/** Failed leaf tests across every suite map, deduped by uid (last wins, matching
 *  the sidebar's root-suite dedup so we read the freshest fragment). */
function collectFailedTests(
  suites: Record<string, SuiteStatsFragment>[] | undefined
): TestStatsFragment[] {
  const byUid = new Map<string, TestStatsFragment>()
  const visit = (suite: SuiteStatsFragment) => {
    for (const test of suite.tests ?? []) {
      if (test.state === 'failed') {
        byUid.set(test.uid, test)
      }
    }
    for (const child of suite.suites ?? []) {
      visit(child)
    }
  }
  for (const map of suites ?? []) {
    for (const suite of Object.values(map)) {
      visit(suite)
    }
  }
  return [...byUid.values()]
}

function commandErrors(commands: CommandLog[] | undefined): CollectedError[] {
  return (commands ?? [])
    .flatMap((command) => {
      const read = readError(command.error)
      if (!read) {
        return []
      }
      const values = assertionValues(command)
      return [
        {
          title: command.title ?? command.command,
          message: read.message,
          stack: read.stack,
          callSource: command.callSource,
          command,
          timestamp: command.timestamp,
          expected: values.expected ?? read.expected,
          actual: values.actual ?? read.actual
        }
      ]
    })
    .sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0))
}

/**
 * Build the Errors-tab list from the live/player contexts.
 *
 * Command failures come first (time-ordered) because they carry the clickable
 * action; a failed test that only echoes a command's message is dropped so the
 * same failure isn't listed twice (e.g. a Cucumber `Then` fails as both the
 * assertion command and the scenario).
 */
export function collectErrors(
  commands: CommandLog[] | undefined,
  suites: Record<string, SuiteStatsFragment>[] | undefined
): CollectedError[] {
  const fromCommands = commandErrors(commands)
  const seenMessages = new Set(fromCommands.map((e) => e.message))

  const fromTests = collectFailedTests(suites).flatMap((test) => {
    const read = readError(test.error ?? test.errors?.[0])
    if (!read || seenMessages.has(read.message)) {
      return []
    }
    return [
      {
        title: test.fullTitle || test.title || test.uid,
        message: read.message,
        stack: read.stack,
        callSource: test.callSource,
        expected: read.expected,
        actual: read.actual
      }
    ]
  })

  return [...fromCommands, ...fromTests]
}
