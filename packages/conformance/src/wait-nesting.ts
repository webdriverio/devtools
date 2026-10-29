import {
  isWaitCommand,
  mapCommandToAction,
  type CommandLog
} from '@wdio/devtools-shared'

import { RULES, SCENARIO_TESTS, SCENARIO_WAITS, SCOPES } from './constants.js'
import {
  reportedTests,
  scenarioIndex,
  scenarioTestsOf
} from './scenario-tests.js'
import type { RecordedStream, Violation } from './types.js'

const isWait = (row: CommandLog) => isWaitCommand(row.command)

const waitKey = (row: CommandLog) => {
  const action = mapCommandToAction(row.command)!
  return `${action.class}.${action.method} ${row.selector ?? ''}`.trim()
}

const startOf = (row: CommandLog) => row.startTime ?? row.timestamp

const onRow = (row: CommandLog) => ({
  kind: 'row' as const,
  timestamp: row.timestamp
})

/**
 * A wait is one row, named after what it waited for, sent when it starts and replaced by `id` when it ends, and every
 * command its condition issued names that row as `parentId`. Judged from the rows' own spans: a row that ran inside a
 * wait's span in the same test was issued by it.
 */
export function checkWaitNesting(stream: RecordedStream): Violation[] {
  const testOf = scenarioTestsOf(reportedTests(stream.frames), stream.rows)
  const test = new Map(stream.rows.map((row, i) => [row, testOf[i]]))
  const waits = stream.rows.filter(isWait)
  const sent = sendOrder(stream)
  return [
    ...scenarioWaits(stream, waits, test),
    ...waits.flatMap((wait) => waitIdentity(wait, sent.firstSent)),
    ...stream.rows.flatMap((row) => parentOf(row, waits, test)),
    ...sentBeforeChildren(sent)
  ]
}

// Each reported test shows exactly the waits it writes, under the names a dashboard user reads.
function scenarioWaits(
  stream: RecordedStream,
  waits: CommandLog[],
  test: Map<CommandLog, number>
): Violation[] {
  return reportedTests(stream.frames).flatMap(({ title }) => {
    const index = scenarioIndex(title)
    if (index === -1) {
      return []
    }
    const written = SCENARIO_WAITS[SCENARIO_TESTS[index].title] ?? []
    const shown = waits.filter((w) => test.get(w) === index).map(waitKey)
    if (shown.join(', ') === written.join(', ')) {
      return []
    }
    return [
      {
        rule: RULES.waitParentsItsRows,
        message: `"${SCENARIO_TESTS[index].title}" shows waits [${shown.join(', ')}]; the scenario writes [${written.join(', ')}]`
      }
    ]
  })
}

// Python has no undefined and writes a missing result as null, so only a value other than null is a result.
const hasResult = (row: CommandLog) =>
  row.result !== undefined && row.result !== null

// A wait is first sent running, at its start, so the rows it issues have a row to nest under while it runs.
function waitIdentity(
  wait: CommandLog,
  firstSent: Map<number, SentRow>
): Violation[] {
  const lacks = [
    ...(typeof wait.id === 'number' ? [] : ['id']),
    ...(wait.startTime === undefined ? ['startTime'] : [])
  ]
  const first = typeof wait.id === 'number' ? firstSent.get(wait.id) : undefined
  const message = lacks.length
    ? `${waitKey(wait)} has no ${lacks.join(' or ')}, so the rows it issued cannot be nested under it`
    : first &&
        (first.row.error ||
          hasResult(first.row) ||
          first.row.timestamp !== wait.startTime)
      ? `${waitKey(wait)} is first sent once it has ended, so a live list cannot nest what it issues while it runs`
      : undefined
  return message
    ? [{ rule: RULES.waitParentsItsRows, message, subject: onRow(wait) }]
    : []
}

// The waits whose span holds the row's, in the row's own test, innermost first.
function enclosingWaits(
  row: CommandLog,
  waits: CommandLog[],
  test: Map<CommandLog, number>
): CommandLog[] {
  return waits
    .filter(
      (w) =>
        w !== row &&
        w.startTime !== undefined &&
        test.get(w) === test.get(row) &&
        startOf(row) >= w.startTime &&
        startOf(row) < w.timestamp &&
        row.timestamp <= w.timestamp
    )
    .sort((a, b) => startOf(b) - startOf(a))
}

function parentOf(
  row: CommandLog,
  waits: CommandLog[],
  test: Map<CommandLog, number>
): Violation[] {
  const holding = enclosingWaits(row, waits, test)
  // Spans are whole milliseconds, so a row that started in a wait's first millisecond may have run just before it:
  // the innermost wait it started strictly inside must parent it, unless a wait that ties with it does.
  const strict = holding.findIndex((w) => startOf(row) > w.startTime!)
  const wait = holding[strict]
  const parents = holding.slice(0, strict + 1)
  if (
    wait &&
    !parents.some((w) => w.id !== undefined && row.parentId === w.id)
  ) {
    return [
      {
        rule: RULES.waitParentsItsRows,
        message: `${row.command} ran inside ${waitKey(wait)} but names ${row.parentId === undefined ? 'no parent' : `parent ${row.parentId}`}`,
        subject: onRow(row)
      }
    ]
  }
  return []
}

interface SentRow {
  row: CommandLog
  /** Its position in send order, counted across frames and within one, since a frame can batch a parent and its child. */
  at: number
}

/** Each id's first send, and every send of a row naming a parent, in frame order. */
function sendOrder(stream: RecordedStream): {
  firstSent: Map<number, SentRow>
  children: SentRow[]
} {
  const firstSent = new Map<number, SentRow>()
  const children: SentRow[] = []
  let at = 0
  stream.frames.forEach(({ scope, data }) => {
    const rows =
      scope === SCOPES.commands
        ? (data as CommandLog[])
        : scope === SCOPES.replaceCommand
          ? [(data as { command: CommandLog }).command]
          : []
    for (const row of rows) {
      if (typeof row.id === 'number' && !firstSent.has(row.id)) {
        firstSent.set(row.id, { row, at })
      }
      if (typeof row.parentId === 'number') {
        children.push({ row, at })
      }
      at++
    }
  })
  return { firstSent, children }
}

// Live mode nests a row on arrival only if the row it names was sent first: as the running wait.
function sentBeforeChildren({
  firstSent,
  children
}: ReturnType<typeof sendOrder>): Violation[] {
  return children.flatMap(({ row, at }) => {
    const parentAt = firstSent.get(row.parentId!)?.at
    if (parentAt !== undefined && parentAt < at) {
      return []
    }
    return [
      {
        rule: RULES.waitParentsItsRows,
        message:
          parentAt === undefined
            ? `${row.command} names parent ${row.parentId}, which no row in the stream carries`
            : `${row.command} was sent before parent ${row.parentId}, so a live list shows it beside the wait`,
        subject: onRow(row)
      }
    ]
  })
}
