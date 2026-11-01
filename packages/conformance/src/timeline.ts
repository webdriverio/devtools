import type { CommandLog } from '@wdio/devtools-shared'

import { navigationTarget, readStream } from './checker.js'
import { TARGET_MAX_CHARS } from './constants.js'
import type { RunReport, Timeline, TimelineEvent, Violation } from './types.js'

const KIND_ORDER: Record<TimelineEvent['kind'], number> = {
  document: 0,
  anchor: 1,
  row: 2
}

/** Orders a run's documents, anchors and rows by time and attaches each violation to the event it concerns. */
export function buildTimeline(report: RunReport): Timeline {
  const { rows, anchors } = readStream(report.frames)
  const events: TimelineEvent[] = [
    ...report.truth.documents.map((d): TimelineEvent => ({
      kind: 'document',
      at: d.bornAt,
      url: d.url,
      violations: []
    })),
    ...anchors.map((a): TimelineEvent => ({
      kind: 'anchor',
      at: a.timestamp,
      url: a.url ?? '',
      violations: []
    })),
    ...rows.map(rowEvent)
  ].sort((a, b) => a.at - b.at || KIND_ORDER[a.kind] - KIND_ORDER[b.kind])

  const unplaced: Violation[] = []
  for (const violation of report.violations) {
    const event = events.find((e) => concerns(e, violation))
    if (event) {
      event.violations.push(violation)
    } else {
      unplaced.push(violation)
    }
  }
  return { origin: origin(events), events, unplaced }
}

function rowEvent(row: CommandLog): TimelineEvent {
  return {
    kind: 'row',
    at: row.startTime ?? row.timestamp,
    command: row.command,
    target: rowTarget(row),
    startTime: row.startTime,
    timestamp: row.timestamp,
    failed: Boolean(row.error),
    violations: []
  }
}

function rowTarget(row: CommandLog): string {
  const target =
    navigationTarget(row) ??
    row.selector ??
    (row.args.length ? JSON.stringify(row.args) : '')
  return target.length > TARGET_MAX_CHARS
    ? `${target.slice(0, TARGET_MAX_CHARS)}...`
    : target
}

function concerns(event: TimelineEvent, { subject }: Violation): boolean {
  if (!subject || subject.kind !== event.kind) {
    return false
  }
  const stamp = event.kind === 'row' ? event.timestamp : event.at
  return stamp === subject.timestamp
}

function origin(events: TimelineEvent[]): number {
  // A row that breaks the completion rule ends before it starts, so its end can be the earliest time.
  const times = events.flatMap((e) =>
    e.kind === 'row' ? [e.at, e.timestamp] : [e.at]
  )
  return times.length ? Math.min(...times) : 0
}
