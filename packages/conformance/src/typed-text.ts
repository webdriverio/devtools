import { SCRUB_MIN_LENGTH, type CommandLog } from '@wdio/devtools-shared'

import { RULES, SCOPES } from './constants.js'
import type { GroundTruth, RecordedStream, Violation } from './types.js'

/** WebDriver's special keys say which key was pressed; the typed text is what is left. */
const SPECIAL_KEY = /[\uE000-\uF8FF]/gu

/** The test's own source is out of scope: a credential written in it is the test author's to keep out. */
const SOURCE_SCOPE = 'sources'

/** A suite tree carries each test's source as `body`, the same source by another route. */
function withoutTestSource(scope: string, data: unknown): string {
  return JSON.stringify(data, (key, value: unknown) =>
    scope === SCOPES.suites && key === 'body' ? undefined : value
  )
}

function stringsIn(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') {
    out.push(value)
  } else if (Array.isArray(value)) {
    value.forEach((item) => stringsIn(item, out))
  } else if (value && typeof value === 'object') {
    Object.values(value).forEach((item) => stringsIn(item, out))
  }
  return out
}

function rowCarries(row: CommandLog, typed: string): boolean {
  return stringsIn([row.args, row.result, row.error, row.title]).includes(typed)
}

// A typed value never reaches the dashboard: a row's arguments or result never equal it, and no frame other than
// the test's own source contains it once it is long enough to be told apart from ordinary words.
export function checkTypedText(
  stream: RecordedStream,
  truth: GroundTruth
): Violation[] {
  const typed = [
    ...new Set(truth.typed.map((text) => text.replace(SPECIAL_KEY, '')))
  ].filter(Boolean)
  return typed.flatMap((text) => {
    const rows = stream.rows.filter((row) => rowCarries(row, text))
    const frames =
      text.length < SCRUB_MIN_LENGTH
        ? []
        : stream.frames.filter(
            ({ scope, data }) =>
              scope !== SOURCE_SCOPE &&
              withoutTestSource(scope, data).includes(text)
          )
    return [
      ...rows.map((row) => ({
        rule: RULES.typedTextMasked,
        message: `the ${row.command} row carries text the browser was typed`,
        subject: { kind: 'row' as const, timestamp: row.timestamp }
      })),
      ...frames.map(({ scope }) => ({
        rule: RULES.typedTextMasked,
        message: `a ${scope} frame carries text the browser was typed`
      }))
    ]
  })
}
