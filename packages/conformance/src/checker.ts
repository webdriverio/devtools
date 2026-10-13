import {
  mapCommandToAction,
  replaceCommand,
  type CommandLog,
  type Metadata,
  type RunnerOptions,
  type ReplaceCommandWsPayload,
  type TraceMutation
} from '@wdio/devtools-shared'

import { ACTION_METHODS, RULES, SCOPES } from './constants.js'
import type {
  ActionMethod,
  GroundTruth,
  RecordedStream as Stream,
  Violation,
  WireFrame
} from './types.js'

export function checkConformance(
  frames: WireFrame[],
  truth: GroundTruth
): Violation[] {
  const stream = readStream(frames)
  return [
    ...metadataFirst(stream),
    ...completionStamp(stream, truth),
    ...anchors(stream, truth),
    ...rowReplaysPage(stream, truth),
    ...navigationNamesDestination(stream, truth),
    ...failureRecorded(stream, truth),
    ...replaceTargetsRow(stream),
    ...rowPerAction(stream, truth),
    ...runControlsServed(stream)
  ]
}

// The rules read three fields off every row, so a frame that lacks them is reported rather than guessed at.
export function readStream(frames: WireFrame[]): Stream {
  let rows: CommandLog[] = []
  const anchors: TraceMutation[] = []
  frames.forEach(({ scope, data }, i) => {
    if (scope === SCOPES.commands) {
      rows.push(...rowsOf(data, i))
    } else if (scope === SCOPES.replaceCommand) {
      // The dashboard's own rule, so the rows judged are the rows a user sees.
      const { oldTimestamp, command } = data as ReplaceCommandWsPayload
      rows = replaceCommand(rows, oldTimestamp, rowsOf([command], i)[0])
    } else if (scope === SCOPES.mutations) {
      anchors.push(
        ...arrayOf(data, i).filter(
          (m): m is TraceMutation =>
            (m as TraceMutation).type === 'childList' &&
            (m as TraceMutation).url !== undefined
        )
      )
    }
  })
  anchors.sort((a, b) => a.timestamp - b.timestamp)
  return { frames, rows, anchors }
}

function arrayOf(data: unknown, frame: number): unknown[] {
  if (!Array.isArray(data)) {
    throw new Error(`frame #${frame} carries ${typeof data}, not an array`)
  }
  return data
}

function rowsOf(data: unknown, frame: number): CommandLog[] {
  const rows = arrayOf(data, frame) as Partial<CommandLog>[]
  for (const row of rows) {
    if (
      typeof row?.command !== 'string' ||
      !Array.isArray(row.args) ||
      typeof row.timestamp !== 'number'
    ) {
      throw new Error(
        `commands frame #${frame} carries a row without command, args[] and timestamp: ${JSON.stringify(row).slice(0, 120)}`
      )
    }
  }
  return rows as CommandLog[]
}

function metadataFirst({ frames }: Stream): Violation[] {
  const metadata = frames.findIndex((f) => f.scope === SCOPES.metadata)
  const commands = frames.findIndex((f) => f.scope === SCOPES.commands)
  if (commands === -1 || (metadata !== -1 && metadata < commands)) {
    return []
  }
  return [
    {
      rule: RULES.metadataFirst,
      message: `first commands frame (#${commands}) arrived before any metadata`,
      ...rowSubject((frames[commands].data as CommandLog[])[0])
    }
  ]
}

function completionStamp({ rows }: Stream, truth: GroundTruth): Violation[] {
  const inverted = rows
    .filter((r) => r.startTime !== undefined && r.startTime > r.timestamp)
    .map((r) => ({
      rule: RULES.completionStamp,
      message: `${r.command} ends (${r.timestamp}) before it starts (${r.startTime})`,
      ...rowSubject(r)
    }))
  // The nth row of an action kind is the nth such action the browser completed; equal ms is fine.
  const early = ACTION_METHODS.flatMap((method) => {
    const completions = truth.actions[method]
    return rows
      .filter((r) => mapCommandToAction(r.command)?.method === method)
      .flatMap((r, i) =>
        i < completions.length && r.timestamp < completions[i]
          ? [
              {
                rule: RULES.completionStamp,
                message: `${r.command} is stamped ${r.timestamp}, before the browser completed it at ${completions[i]}`,
                ...rowSubject(r)
              }
            ]
          : []
      )
  })
  return [...inverted, ...early]
}

// The collector stamps an anchor with its document's own birth time, so a match is exact.
function anchors(stream: Stream, truth: GroundTruth): Violation[] {
  const counts = truth.documents.map(() => 0)
  const out: Violation[] = []
  for (const anchor of stream.anchors) {
    const at = truth.documents.findIndex(
      (d) => d.url === anchor.url && d.bornAt === anchor.timestamp
    )
    if (at === -1) {
      out.push({
        rule: RULES.anchorBirthTime,
        message: `anchor for ${anchor.url} at ${anchor.timestamp} matches no document born then`,
        subject: {
          kind: 'anchor',
          timestamp: anchor.timestamp,
          url: anchor.url
        }
      })
      continue
    }
    counts[at]++
  }
  truth.documents.forEach((doc, i) => {
    if (counts[i] === 0) {
      out.push({
        rule: RULES.documentAnchored,
        message: `document ${doc.url} born at ${doc.bornAt} has no anchor`,
        subject: { kind: 'document', timestamp: doc.bornAt, url: doc.url }
      })
    } else if (counts[i] > 1) {
      out.push({
        rule: RULES.anchorOnce,
        message: `document ${doc.url} born at ${doc.bornAt} has ${counts[i]} anchors`,
        subject: { kind: 'document', timestamp: doc.bornAt, url: doc.url }
      })
    }
  })
  return out
}

// Every action row replays the document the browser was on when that action completed, not only navigations.
function rowReplaysPage(stream: Stream, truth: GroundTruth): Violation[] {
  return completedActions(stream, truth).flatMap(({ row, completed }) => {
    const current = currentDocumentAt(truth, completed)
    const shown = stream.anchors
      .filter((a) => a.timestamp <= row.timestamp)
      .at(-1)
    // A row before any document has nothing to replay.
    if (!current || shown?.url === current.url) {
      return []
    }
    const target = navigationTarget(row) ?? row.selector ?? ''
    return [
      {
        rule: RULES.rowReplaysPage,
        message: `${row.command}(${target}) at ${row.timestamp} replays ${shown?.url ?? 'no document'}; the browser was on ${current.url}`,
        ...rowSubject(row)
      }
    ]
  })
}

// The page a successful navigation row names is the one the browser had loaded when it completed.
function navigationNamesDestination(
  stream: Stream,
  truth: GroundTruth
): Violation[] {
  return completedActions(stream, truth).flatMap(
    ({ row, method, completed }) => {
      const target = navigationTarget(row)
      const loaded = currentDocumentAt(truth, completed)
      if (method !== 'navigate' || row.error || !target || !loaded) {
        return []
      }
      return loaded.url === target
        ? []
        : [
            {
              rule: RULES.navigationNamesDestination,
              message: `${row.command} names ${target}; the browser loaded ${loaded.url}`,
              ...rowSubject(row)
            }
          ]
    }
  )
}

// The nth row of an action kind is the nth such action the browser completed; an extra row is rowPerAction's finding.
function completedActions(
  stream: Stream,
  truth: GroundTruth
): Array<{ row: CommandLog; method: ActionMethod; completed: number }> {
  const seen: Record<ActionMethod, number> = { navigate: 0, click: 0, fill: 0 }
  return stream.rows.flatMap((row) => {
    const method = actionMethodOf(row)
    const completed = method && truth.actions[method][seen[method]++]
    return method && completed !== undefined ? [{ row, method, completed }] : []
  })
}

function currentDocumentAt(truth: GroundTruth, at: number) {
  return truth.documents.filter((d) => d.bornAt <= at).at(-1)
}

function actionMethodOf(row: CommandLog): ActionMethod | undefined {
  const method = mapCommandToAction(row.command)?.method
  return (ACTION_METHODS as readonly string[]).includes(method ?? '')
    ? (method as ActionMethod)
    : undefined
}

function failureRecorded(stream: Stream, truth: GroundTruth): Violation[] {
  return truth.failedNavigations.flatMap(({ url, message }): Violation[] => {
    const row = stream.rows.find((r) => navigationTarget(r) === url && r.error)
    if (!row) {
      return [
        {
          rule: RULES.failureRecorded,
          message: `navigation to ${url} failed in the browser but no row carries an error`
        }
      ]
    }
    // The Errors tab shows this text, so it must be the browser's, not a binding's formatting of it.
    const shown = row.error?.message.trim()
    return shown === message
      ? []
      : [
          {
            rule: RULES.errorCarriesBrowserMessage,
            message: `${row.command}(${url}) shows ${JSON.stringify(row.error?.message)} instead of ${JSON.stringify(message)}`,
            subject: { kind: 'row', timestamp: row.timestamp }
          }
        ]
  })
}

function replaceTargetsRow({ frames }: Stream): Violation[] {
  const sent = new Set<number>()
  const out: Violation[] = []
  for (const { scope, data } of frames) {
    if (scope === SCOPES.commands) {
      for (const row of data as CommandLog[]) {
        sent.add(row.timestamp)
      }
    } else if (scope === SCOPES.replaceCommand) {
      const { oldTimestamp } = data as ReplaceCommandWsPayload
      if (!sent.has(oldTimestamp)) {
        out.push({
          rule: RULES.replaceTargetsRow,
          message: `replaceCommand names ${oldTimestamp}, which no earlier row carries`
        })
      }
    }
  }
  return out
}

function rowSubject(row: CommandLog | undefined): Pick<Violation, 'subject'> {
  return row ? { subject: { kind: 'row', timestamp: row.timestamp } } : {}
}

// A lost row and a duplicated one both break every invariant silently, so rows are counted against the browser.
// Served by a shell command, or by a config file the backend reruns through its framework path (WDIO, Nightwatch).
export function servesRunControls(options: RunnerOptions | undefined): boolean {
  return Boolean(
    options?.launchCommand || options?.rerunCommand || options?.configFile
  )
}

// Without any of those the backend falls back to the wdio binary, which is wrong for every other project.
function runControlsServed({ frames }: Stream): Violation[] {
  return frames
    .filter((f) => f.scope === SCOPES.metadata)
    .flatMap((f) => {
      const options = (f.data as Metadata).options as RunnerOptions | undefined
      const advertised = Object.entries(options?.runCapabilities ?? {})
        .filter(([, on]) => on)
        .map(([name]) => name)
      if (!advertised.length || servesRunControls(options)) {
        return []
      }
      return [
        {
          rule: RULES.runControlsServed,
          message: `metadata advertises ${advertised.join(', ')} but carries no launchCommand, rerunCommand or configFile to serve them`
        }
      ]
    })
}

function rowPerAction(stream: Stream, truth: GroundTruth): Violation[] {
  return ACTION_METHODS.flatMap((method) => {
    const rows = stream.rows.filter(
      (r) => mapCommandToAction(r.command)?.method === method
    ).length
    const received = truth.actions[method].length
    return rows === received
      ? []
      : [
          {
            rule: RULES.rowPerAction,
            message: `${method}: the browser received ${received}, the stream shows ${rows} row(s)`
          }
        ]
  })
}

/** The url a navigation row loads, passed bare (`get(url)`) or as W3C `{url}`. */
export function navigationTarget(row: CommandLog): string | undefined {
  if (mapCommandToAction(row.command)?.method !== 'navigate') {
    return undefined
  }
  const [arg] = row.args
  if (typeof arg === 'string') {
    return arg
  }
  const url = (arg as { url?: unknown } | undefined)?.url
  return typeof url === 'string' ? url : undefined
}
