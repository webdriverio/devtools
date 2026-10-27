import { strFromU8, unzipSync } from 'fflate'

import {
  TRACE_EVENT_TYPES,
  TRACE_STREAM_SUFFIXES,
  type TraceEventType
} from '@wdio/devtools-shared'

import { NODEID_SEPARATOR, TIMEOUT_PATTERNS } from './constants.js'
import type {
  ExampleExpectations,
  RunOutcome,
  SmokeTrace,
  TestExpectation,
  TraceRow
} from './types.js'

const TRACING_GROUP_CLASS = 'Tracing'

// The trace stream is untrusted JSON; only the fields read below are narrowed.
interface RawEvent {
  type?: TraceEventType
  callId?: string
  parentId?: string
  class?: string
  method?: string
  title?: string
  text?: string
  error?: { message?: string }
}

export function parseTraceNdjson(source: string, ndjson: string): SmokeTrace {
  const trace: SmokeTrace = { source, rows: [], groups: new Map(), stdio: [] }
  const errors = new Map<string, string>()
  ndjson.split('\n').forEach((line, index) => {
    if (!line.trim()) {
      return
    }
    let event: RawEvent
    try {
      event = JSON.parse(line) as RawEvent
    } catch (err) {
      throw new Error(
        `${source}: line ${index + 1} is not JSON (${String(err)})`
      )
    }
    if (event.type === TRACE_EVENT_TYPES.before && event.callId) {
      if (event.class === TRACING_GROUP_CLASS) {
        trace.groups.set(event.callId, {
          title: event.title ?? '',
          parentId: event.parentId
        })
      } else {
        trace.rows.push({
          callId: event.callId,
          parentId: event.parentId,
          label: `${event.class}.${event.method}`,
          title: event.title ?? ''
        })
      }
    } else if (
      event.type === TRACE_EVENT_TYPES.after &&
      event.callId &&
      event.error
    ) {
      errors.set(event.callId, event.error.message ?? 'error')
    } else if (
      event.type === TRACE_EVENT_TYPES.stdout ||
      event.type === TRACE_EVENT_TYPES.stderr
    ) {
      trace.stdio.push(event.text ?? '')
    }
  })
  for (const row of trace.rows) {
    row.error = errors.get(row.callId)
  }
  return trace
}

/** Every `.trace` stream in a zip, each parsed on its own because callIds are per stream. */
export function readSmokeTrace(source: string, zip: Uint8Array): SmokeTrace[] {
  const files = unzipSync(zip, {
    filter: (file) => file.name.endsWith(TRACE_STREAM_SUFFIXES.trace)
  })
  const names = Object.keys(files).sort()
  if (names.length === 0) {
    throw new Error(`${source}: no *${TRACE_STREAM_SUFFIXES.trace} stream`)
  }
  return names.map((name) =>
    parseTraceNdjson(
      names.length === 1 ? source : `${source}:${name}`,
      strFromU8(files[name]!)
    )
  )
}

function matchesTest(title: string, test: string): boolean {
  return title === test || title.endsWith(`${NODEID_SEPARATOR}${test}`)
}

function rowsFor(
  traces: SmokeTrace[],
  expectation: TestExpectation
): TraceRow[] {
  if (expectation.scope === 'run') {
    return traces.flatMap((trace) => trace.rows)
  }
  return traces.flatMap((trace) =>
    trace.rows.filter((row) => {
      const group = row.parentId ? trace.groups.get(row.parentId) : undefined
      return group !== undefined && matchesTest(group.title, expectation.test)
    })
  )
}

function missingRows(expected: string[], rows: TraceRow[]): string[] {
  const available = new Map<string, number>()
  for (const row of rows) {
    available.set(row.label, (available.get(row.label) ?? 0) + 1)
  }
  const missing: string[] = []
  for (const label of expected) {
    const left = available.get(label) ?? 0
    if (left > 0) {
      available.set(label, left - 1)
    } else {
      missing.push(label)
    }
  }
  return missing
}

function describeRows(rows: TraceRow[]): string {
  return rows.length
    ? rows.map((r) => (r.error ? `${r.label} [error]` : r.label)).join(', ')
    : '(none)'
}

function groupTitlesSeen(traces: SmokeTrace[]): string {
  const titles = new Set(
    traces.flatMap((t) => [...t.groups.values()].map((g) => g.title))
  )
  return [...titles].map((t) => `"${t}"`).join(', ') || '(none)'
}

function checkTest(
  expectation: TestExpectation,
  traces: SmokeTrace[]
): string[] {
  const scope =
    expectation.scope === 'run' ? 'the run' : `test "${expectation.test}"`
  const rows = rowsFor(traces, expectation)
  if (expectation.scope !== 'run' && rows.length === 0) {
    return [
      `${scope}: no rows under a group with that title; groups seen: ${groupTitlesSeen(traces)}`
    ]
  }
  const failures: string[] = []
  const missing = missingRows(expectation.rows ?? [], rows)
  if (missing.length) {
    failures.push(
      `${scope}: missing rows ${missing.join(', ')}; found ${describeRows(rows)}`
    )
  }
  const errorRows = rows.filter((row) => row.error !== undefined)
  if (expectation.error === true && errorRows.length === 0) {
    failures.push(
      `${scope}: expected an error row, found none; rows ${describeRows(rows)}`
    )
  }
  if (expectation.error === false && errorRows.length > 0) {
    failures.push(
      `${scope}: unexpected error rows: ${errorRows.map((r) => `${r.label}: ${r.error}`).join('; ')}`
    )
  }
  const needle = expectation.errorMatches
  if (
    needle !== undefined &&
    !errorRows.some((row) => row.error?.includes(needle))
  ) {
    failures.push(
      `${scope}: no error row mentions "${needle}"; errors: ${errorRows.map((r) => r.error).join('; ') || '(none)'}`
    )
  }
  return failures
}

export function findTimeout(text: string): boolean {
  return TIMEOUT_PATTERNS.some((pattern) => pattern.test(text))
}

function checkTimeouts(
  expectations: ExampleExpectations,
  traces: SmokeTrace[],
  outcome: RunOutcome
): string[] {
  if (expectations.allowTimeoutError) {
    return []
  }
  const failures: string[] = []
  for (const trace of traces) {
    const hit = trace.stdio.find(findTimeout)
    if (hit !== undefined) {
      failures.push(
        `${trace.source}: stdout carries a timeout: ${hit.slice(0, 300)}`
      )
    }
  }
  const logHit = outcome.log?.split('\n').find(findTimeout)
  if (logHit !== undefined) {
    failures.push(
      `runner log carries a timeout: ${logHit.trim().slice(0, 300)}`
    )
  }
  return failures
}

/** Every unmet expectation as one line; empty means the example passed. */
export function checkExample(
  expectations: ExampleExpectations,
  traces: SmokeTrace[],
  outcome: RunOutcome = {}
): string[] {
  if (traces.length === 0) {
    return ['no trace-*.zip was produced']
  }
  const failures = expectations.tests.flatMap((test) => checkTest(test, traces))
  if (
    outcome.exitCode !== undefined &&
    (outcome.exitCode !== 0) !== expectations.runFails
  ) {
    failures.push(
      `run exited ${outcome.exitCode}, expected ${expectations.runFails ? 'a failing exit (it has deliberately failing tests)' : '0'}`
    )
  }
  return [...failures, ...checkTimeouts(expectations, traces, outcome)]
}
