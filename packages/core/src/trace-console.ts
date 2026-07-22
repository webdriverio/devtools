// Maps captured ConsoleLog entries into trace-event vocabulary: browser
// console entries become `console` events; test/terminal output becomes
// `stdout`/`stderr` events (which carry no location semantics — matching
// what we capture for Node-side lines).

import type { ConsoleLog, LogSource } from '@wdio/devtools-shared'

export interface ConsoleEvent {
  type: 'console'
  time: number
  pageId?: string
  messageType: string
  text: string
  args?: { preview: string; value: unknown }[]
  location: { url: string; lineNumber: number; columnNumber: number }
}

export interface StdioEvent {
  type: 'stdout' | 'stderr'
  timestamp: number
  text?: string
  /** Extension field: test-vs-terminal origin; foreign viewers ignore it. */
  source?: Extract<LogSource, 'test' | 'terminal'>
}

// Caps pathological runs (console.log in a loop) so the trace stays openable.
const MAX_CONSOLE_EVENTS = 10_000

/** Trace vocabulary uses 'warning'; 'trace' maps to the nearest severity, 'debug'. */
function toTraceLevel(level: ConsoleLog['type']): string {
  if (level === 'warn') {
    return 'warning'
  }
  if (level === 'trace') {
    return 'debug'
  }
  return level
}

function previewArg(arg: unknown): string {
  if (typeof arg === 'string') {
    return arg
  }
  try {
    return JSON.stringify(arg) ?? String(arg)
  } catch {
    return String(arg)
  }
}

export function buildConsoleEvents(
  logs: ConsoleLog[],
  pageId: string,
  wallTime: number
): (ConsoleEvent | StdioEvent)[] {
  const capped = logs.slice(0, MAX_CONSOLE_EVENTS)
  const events: (ConsoleEvent | StdioEvent)[] = capped.map((log) => {
    const time = Math.max(0, log.timestamp - wallTime)
    const text = log.args.map(previewArg).join(' ')
    // Untagged entries predate source tagging; they came from the page.
    if (log.source === 'browser' || log.source === undefined) {
      return {
        type: 'console',
        time,
        pageId,
        messageType: toTraceLevel(log.type),
        text,
        args: log.args.map((arg) => ({ preview: previewArg(arg), value: arg })),
        // Location isn't captured at the patch site; the required field ships zeroed.
        location: { url: '', lineNumber: 0, columnNumber: 0 }
      } satisfies ConsoleEvent
    }
    return {
      type: log.type === 'error' || log.type === 'warn' ? 'stderr' : 'stdout',
      timestamp: time,
      text,
      source: log.source
    } satisfies StdioEvent
  })
  if (logs.length > MAX_CONSOLE_EVENTS) {
    const last = capped[capped.length - 1]
    events.push({
      type: 'stderr',
      timestamp: last ? Math.max(0, last.timestamp - wallTime) : 0,
      text: `[devtools] console truncated: dropped ${logs.length - MAX_CONSOLE_EVENTS} entries`
    })
  }
  return events
}
