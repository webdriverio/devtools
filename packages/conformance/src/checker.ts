import {
  mapCommandToAction,
  NETWORK_CAPTURE_SOURCE,
  replaceCommand,
  replaceCommandIndex,
  resolveRunCapabilities,
  type CommandLog,
  type Metadata,
  type NetworkRequest,
  type RunnerOptions,
  type WsPayloadFor,
  type ReplaceCommandWsPayload,
  type TraceMutation
} from '@wdio/devtools-shared'

import { ACTION_METHODS, RULES, SCOPES } from './constants.js'
import { checkCallSites } from './call-site.js'
import { checkPageLevelAssertions, checkTestRows } from './scenario-tests.js'
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
    ...navigationTimings(stream),
    ...failureRecorded(stream, truth),
    ...replaceTargetsRow(stream),
    ...rowPerAction(stream, truth),
    ...runControlsServed(stream),
    ...requestsListed(stream, truth),
    ...requestSourceServed(stream, truth),
    ...checkCallSites(stream, truth.scenarioFile),
    ...checkTestRows(stream),
    ...checkPageLevelAssertions(stream)
  ]
}

// The rules read three fields off every row, so a frame that lacks them is reported rather than guessed at.
export function readStream(frames: WireFrame[]): Stream {
  let rows: CommandLog[] = []
  const anchors: TraceMutation[] = []
  const requests = new Map<string, NetworkRequest>()
  let unkeyed = 0
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
    } else if (scope === SCOPES.networkRequests) {
      // The dashboard's own rule: a row re-sent under an id it already holds replaces it, a row without one is appended.
      for (const request of requestsOf(data, i)) {
        requests.set(request.id || `unkeyed-${unkeyed++}`, request)
      }
    }
  })
  anchors.sort((a, b) => a.timestamp - b.timestamp)
  return { frames, rows, anchors, requests: [...requests.values()] }
}

/** Request rows the Network tab would list for one url, keyed as the browser's truth keys them. */
function countByUrl(urls: string[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const url of urls) {
    counts.set(url, (counts.get(url) ?? 0) + 1)
  }
  return counts
}

// Every load the browser made is one row, whichever source captured it. Two rules, because the two failures have
// opposite causes and a declared gap covers one: a load listed never was withheld, one listed twice came from two sources.
function requestsListed(stream: Stream, truth: GroundTruth): Violation[] {
  const made = countByUrl(truth.requests.map((r) => r.url))
  const listed = countByUrl(stream.requests.map((r) => r.url))
  const urls = new Set([...made.keys(), ...listed.keys()])
  return [...urls].flatMap((url) => {
    const expected = made.get(url) ?? 0
    const shown = listed.get(url) ?? 0
    if (expected === shown) {
      return []
    }
    return [
      {
        rule: shown < expected ? RULES.requestListed : RULES.requestListedOnce,
        message: `${url}: the browser made ${expected} request(s), the stream lists ${shown} row(s)`,
        subject: {
          kind: 'request' as const,
          timestamp: 0,
          url,
          rows: shown,
          made: expected
        }
      }
    ]
  })
}

// With BiDi serving the session a row carries what the driver saw: a status and the response headers. Without it, a
// row carries what the page could see, which is a status and headers from its fetch/XHR patch or, from its Resource
// Timing, neither; the latter must say so rather than pass as a driver's.
function requestSourceServed(stream: Stream, truth: GroundTruth): Violation[] {
  const live = truth.bidi === 'live'
  return stream.requests.flatMap((request) => {
    const fromPage = request.source === NETWORK_CAPTURE_SOURCE.RESOURCE_TIMING
    const detailed =
      typeof request.status === 'number' &&
      Object.keys(request.responseHeaders ?? {}).length > 0
    if (live && !detailed) {
      return [
        {
          rule: RULES.requestSourceServed,
          message: `${request.url}: BiDi served this request with a status and headers, the row carries ${fromPage ? "the page's Resource Timing" : 'neither'}`
        }
      ]
    }
    if (!live && !fromPage && !detailed) {
      return [
        {
          rule: RULES.requestSourceServed,
          message: `${request.url}: nothing but the page served this row, yet it is neither marked as its Resource Timing nor carrying the status and headers its fetch patch would`
        }
      ]
    }
    return []
  })
}

function arrayOf(data: unknown, frame: number): unknown[] {
  if (!Array.isArray(data)) {
    throw new Error(`frame #${frame} carries ${typeof data}, not an array`)
  }
  return data
}

function requestsOf(data: unknown, frame: number): NetworkRequest[] {
  const requests = arrayOf(data, frame) as Partial<NetworkRequest>[]
  for (const request of requests) {
    if (typeof request?.url !== 'string' || typeof request.id !== 'string') {
      throw new Error(
        `networkRequests frame #${frame} carries a row without url and id: ${JSON.stringify(request).slice(0, 120)}`
      )
    }
  }
  return requests as NetworkRequest[]
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
    // The Errors tab and the error rules read the message; an Error sent raw loses it to JSON.
    if (
      row.error !== undefined &&
      typeof (row.error as { message?: unknown })?.message !== 'string'
    ) {
      throw new Error(
        `commands frame #${frame} carries a failed row whose error has no message: ${JSON.stringify(row.error).slice(0, 120)}`
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

// The page answers its timings after the row was sent, so a row is judged as its last replacement left it.
function navigationTimings({ rows }: Stream): Violation[] {
  return rows
    .filter(
      (r) =>
        actionMethodOf(r) === 'navigate' &&
        !r.error &&
        !r.performance?.navigation
    )
    .map((r) => ({
      rule: RULES.navigationTimings,
      message: `${r.command}(${navigationTarget(r) ?? ''}) never carries the page's navigation timings`,
      ...rowSubject(r)
    }))
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

// Located the way the dashboard locates it (shared replaceCommandIndex: by id, then by the stamp a row now carries).
function replaceTargetsRow({ frames }: Stream): Violation[] {
  let rows: CommandLog[] = []
  const out: Violation[] = []
  for (const { scope, data } of frames) {
    if (scope === SCOPES.commands) {
      rows.push(...(data as CommandLog[]))
    } else if (scope === SCOPES.replaceCommand) {
      const { oldTimestamp, command } = data as ReplaceCommandWsPayload
      if (replaceCommandIndex(rows, oldTimestamp, command) === -1) {
        out.push({
          rule: RULES.replaceTargetsRow,
          message: `replaceCommand names ${oldTimestamp}, which no earlier row carries`
        })
      }
      rows = replaceCommand(rows, oldTimestamp, command)
    }
  }
  return out
}

function rowSubject(row: CommandLog | undefined): Pick<Violation, 'subject'> {
  return row ? { subject: { kind: 'row', timestamp: row.timestamp } } : {}
}

// A lost row and a duplicated one both break every invariant silently, so rows are counted against the browser.
// Served by a shell command, by a config file in the metadata, or by a config frame the backend reruns
// through its framework path (the WDIO service sends the file that way).
export function servesRunControls(frames: WireFrame[]): boolean {
  return frames.some(({ scope, data }) => {
    if (scope === SCOPES.metadata) {
      const options = (data as Metadata).options as RunnerOptions | undefined
      return Boolean(
        options?.launchCommand || options?.rerunCommand || options?.configFile
      )
    }
    return (
      scope === SCOPES.config &&
      Boolean((data as WsPayloadFor<'config'>)?.configFile)
    )
  })
}

/** The controls the dashboard will show for a metadata frame: declared, else the runner's defaults. */
export function advertisedRunControls(metadata: Metadata): string[] {
  return Object.entries(resolveRunCapabilities(metadata))
    .filter(([, on]) => on)
    .map(([name]) => name)
    .sort()
}

// Without any of those the backend falls back to the wdio binary, which is wrong for every other project.
function runControlsServed({ frames }: Stream): Violation[] {
  const served = servesRunControls(frames)
  return frames
    .filter((f) => f.scope === SCOPES.metadata)
    .flatMap((f) => {
      const advertised = advertisedRunControls(f.data as Metadata)
      if (!advertised.length || served) {
        return []
      }
      return [
        {
          rule: RULES.runControlsServed,
          message: `the dashboard will offer ${advertised.join(', ')} but the stream carries no launchCommand, rerunCommand or config file to serve them`
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
