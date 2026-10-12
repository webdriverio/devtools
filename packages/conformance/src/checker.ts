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
    ...completionStamp(stream),
    ...anchors(stream, truth),
    ...navigationShowsDestination(stream),
    ...failureRecorded(stream, truth),
    ...replaceTargetsRow(stream),
    ...rowPerAction(stream, truth),
    ...runControlsHaveCommand(stream)
  ]
}

// Frames are cast per scope: each scope's payload shape is shared's contract.
export function readStream(frames: WireFrame[]): Stream {
  let rows: CommandLog[] = []
  const anchors: TraceMutation[] = []
  for (const { scope, data } of frames) {
    if (scope === SCOPES.commands) {
      rows.push(...(data as CommandLog[]))
    } else if (scope === SCOPES.replaceCommand) {
      // The dashboard's own rule, so the rows judged are the rows a user sees.
      const { oldTimestamp, command } = data as ReplaceCommandWsPayload
      rows = replaceCommand(rows, oldTimestamp, command)
    } else if (scope === SCOPES.mutations) {
      anchors.push(
        ...(data as TraceMutation[]).filter(
          (m) => m.type === 'childList' && m.url !== undefined
        )
      )
    }
  }
  anchors.sort((a, b) => a.timestamp - b.timestamp)
  return { frames, rows, anchors }
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

function completionStamp({ rows }: Stream): Violation[] {
  return rows
    .filter((r) => r.startTime !== undefined && r.startTime > r.timestamp)
    .map((r) => ({
      rule: RULES.completionStamp,
      message: `${r.command} ends (${r.timestamp}) before it starts (${r.startTime})`,
      ...rowSubject(r)
    }))
}

// An anchor belongs to the document born after the previous one and no earlier than the anchor.
function anchors(stream: Stream, truth: GroundTruth): Violation[] {
  const counts = truth.documents.map(() => 0)
  const out: Violation[] = []
  for (const anchor of stream.anchors) {
    const at = truth.documents.findIndex(
      (d, i) =>
        anchor.timestamp <= d.bornAt &&
        (i === 0 || anchor.timestamp > truth.documents[i - 1].bornAt)
    )
    if (at === -1 || truth.documents[at].url !== anchor.url) {
      out.push({
        rule: RULES.anchorBirthTime,
        message: `anchor for ${anchor.url} at ${anchor.timestamp} matches no document born then`,
        subject: { kind: 'anchor', timestamp: anchor.timestamp }
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
        subject: { kind: 'document', timestamp: doc.bornAt }
      })
    } else if (counts[i] > 1) {
      out.push({
        rule: RULES.anchorOnce,
        message: `document ${doc.url} born at ${doc.bornAt} has ${counts[i]} anchors`,
        subject: { kind: 'document', timestamp: doc.bornAt }
      })
    }
  })
  return out
}

function navigationShowsDestination(stream: Stream): Violation[] {
  const out: Violation[] = []
  for (const row of stream.rows) {
    const target = navigationTarget(row)
    if (!target || row.error) {
      continue
    }
    const shown = stream.anchors
      .filter((a) => a.timestamp <= row.timestamp)
      .at(-1)
    if (shown?.url !== target) {
      out.push({
        rule: RULES.navigationShowsDestination,
        message: `${row.command}(${target}) at ${row.timestamp} replays ${shown?.url ?? 'no document'}`,
        ...rowSubject(row)
      })
    }
  }
  return out
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
// The backend falls back from either command to the other, and to the wdio binary only when both are missing.
function runControlsHaveCommand({ frames }: Stream): Violation[] {
  return frames
    .filter((f) => f.scope === SCOPES.metadata)
    .flatMap((f) => {
      const options = (f.data as Metadata).options as RunnerOptions | undefined
      const advertised = Object.entries(options?.runCapabilities ?? {})
        .filter(([, on]) => on)
        .map(([name]) => name)
      if (
        !advertised.length ||
        options?.launchCommand ||
        options?.rerunCommand
      ) {
        return []
      }
      return [
        {
          rule: RULES.runControlsHaveCommand,
          message: `metadata advertises ${advertised.join(', ')} but carries neither launchCommand nor rerunCommand`
        }
      ]
    })
}

function rowPerAction(stream: Stream, truth: GroundTruth): Violation[] {
  return ACTION_METHODS.flatMap((method) => {
    const rows = stream.rows.filter(
      (r) => mapCommandToAction(r.command)?.method === method
    ).length
    const received = truth.actions[method]
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
