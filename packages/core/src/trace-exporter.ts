// Converts a captured TraceLog into a trace.zip Buffer.
// Stays runner-agnostic so the three adapters can call this directly.

import fs from 'node:fs/promises'
import path from 'node:path'
import type {
  ActionSnapshot,
  CommandLog,
  ConsoleLog,
  Metadata,
  NetworkRequest,
  ScreencastFrame,
  TestMetadataMap,
  TraceFormat,
  TraceLog,
  TraceMutation
} from '@wdio/devtools-shared'
import {
  formatActionTitle,
  mapCommandToAction,
  FILL_METHODS,
  type TraceAction
} from './action-mapping.js'
import {
  buildConsoleEvents,
  type ConsoleEvent,
  type StdioEvent
} from './trace-console.js'
import {
  buildFilmstripEvents,
  buildSnapshotResources,
  type ScreencastFrameEvent
} from './trace-snapshots.js'
import { buildDenseScreencast } from './screencast-trace.js'
import {
  buildImageFrameSnapshots,
  FrameSnapshotIndex,
  type FrameSnapshotEvent
} from './trace-frame-snapshots.js'
import { buildActionEvents, type ActionEvent } from './trace-action-events.js'
import { buildSourceResources } from './trace-sources.js'
import { networkRequestToHar } from './trace-har.js'
import { buildTraceZip, type TraceZipResource } from './trace-zip-writer.js'
import { sha1Hex } from './sha1.js'

const TRACE_VERSION = 8
const LIBRARY_NAME = '@wdio/devtools-core'
const LIBRARY_VERSION = '1.0.0'

/** Response bodies above this size are not embedded in the trace. */
const MAX_BODY_RESOURCE_BYTES = 1024 * 1024
/** Per-trace ceiling on total embedded response-body bytes. */
const MAX_TOTAL_BODY_RESOURCE_BYTES = 20 * 1024 * 1024

export interface NetworkBodyCaps {
  maxBodyBytes: number
  maxTotalBytes: number
}

export interface NetworkBodyResources {
  resources: TraceZipResource[]
  sha1ByRequestId: Map<string, string>
}

/** Content-addressed `resources/<sha1>` entries for captured response bodies. */
export function buildNetworkBodyResources(
  requests: NetworkRequest[],
  caps: NetworkBodyCaps = {
    maxBodyBytes: MAX_BODY_RESOURCE_BYTES,
    maxTotalBytes: MAX_TOTAL_BODY_RESOURCE_BYTES
  }
): NetworkBodyResources {
  const resources: TraceZipResource[] = []
  const sha1ByRequestId = new Map<string, string>()
  const stored = new Set<string>()
  let totalBytes = 0
  // Cap skips are silent by design; a warn hook would slot into these branches.
  for (const request of requests) {
    if (request.responseBody === undefined) {
      continue
    }
    const data = Buffer.from(request.responseBody, 'utf8')
    if (data.byteLength > caps.maxBodyBytes) {
      continue
    }
    const sha1 = sha1Hex(data)
    if (stored.has(sha1)) {
      sha1ByRequestId.set(request.id, sha1)
      continue
    }
    if (totalBytes + data.byteLength > caps.maxTotalBytes) {
      continue
    }
    stored.add(sha1)
    totalBytes += data.byteLength
    resources.push({ resourceName: sha1, data })
    sha1ByRequestId.set(request.id, sha1)
  }
  return { resources, sha1ByRequestId }
}

interface ContextOptionsEvent {
  version: number
  type: 'context-options'
  origin: 'library'
  libraryName: string
  libraryVersion: string
  browserName: string
  platform: string
  wallTime: number
  monotonicTime: number
  sdkLanguage: string
  title: string
  contextId: string
  options: { viewport: { width: number; height: number } }
}

type TraceEvent =
  | ContextOptionsEvent
  | ActionEvent
  | ScreencastFrameEvent
  | ConsoleEvent
  | StdioEvent
  | FrameSnapshotEvent

function shortId(sessionId?: string): string {
  return (sessionId ?? Math.random().toString(36).slice(2, 10)).slice(0, 8)
}

function resolveContextNaming(caps: Record<string, unknown> | undefined): {
  browserName: string
  title: string
} {
  const platformName =
    typeof caps?.platformName === 'string'
      ? caps.platformName.toLowerCase()
      : undefined
  const deviceName =
    typeof caps?.['appium:deviceName'] === 'string'
      ? (caps['appium:deviceName'] as string)
      : undefined
  if (platformName === 'android' || platformName === 'ios') {
    return {
      browserName: 'chromium',
      title: deviceName ? `${platformName} — ${deviceName}` : platformName
    }
  }
  const browserName =
    typeof caps?.browserName === 'string' ? caps.browserName : 'chromium'
  return { browserName, title: browserName }
}

function buildContextOptions(
  trace: TraceLog,
  contextId: string,
  wallTime: number
): ContextOptionsEvent {
  const caps = trace.metadata.capabilities as
    | Record<string, unknown>
    | undefined
  const { browserName, title } = resolveContextNaming(caps)
  const viewport = trace.metadata.viewport ?? { width: 1280, height: 720 }
  return {
    version: TRACE_VERSION,
    type: 'context-options',
    origin: 'library',
    libraryName: LIBRARY_NAME,
    libraryVersion: LIBRARY_VERSION,
    browserName,
    platform:
      process.platform === 'darwin'
        ? 'darwin'
        : process.platform === 'win32'
          ? 'windows'
          : 'linux',
    wallTime,
    monotonicTime: 0,
    sdkLanguage: 'javascript',
    title,
    contextId,
    options: {
      viewport: { width: viewport.width, height: viewport.height }
    }
  }
}

function buildNetworkNdjson(
  requests: NetworkRequest[],
  wallTime: number,
  pageId: string,
  sha1ByRequestId: Map<string, string>
): Buffer {
  if (!requests.length) {
    return Buffer.alloc(0)
  }
  const lines = requests.map((r) => {
    const entry = networkRequestToHar(r, {
      bodySha1: sha1ByRequestId.get(r.id)
    }) as unknown as Record<string, unknown>
    entry.snapshot = {
      ...(entry.snapshot as Record<string, unknown>),
      // Monotonic offset so the viewer positions bars on the timeline.
      _monotonicTime: Math.max(0, r.timestamp - wallTime),
      // Browsing context ID so the viewer associates requests with the page.
      _frameref: pageId
    }
    return JSON.stringify(entry)
  })
  return Buffer.from(lines.join('\n'), 'utf8')
}

/**
 * Build a trace.zip buffer from the captured TraceLog.
 * Filters commands through ACTION_MAP and renames to trace vocabulary;
 * network entries become HAR resource-snapshots; per-action screenshots,
 * element JSON, and snapshot text are written under `resources/`.
 */
/** Chronological sort key — see `compareEvents` for the tie-breaker rationale. */
function eventTime(e: TraceEvent): number {
  switch (e.type) {
    case 'context-options':
      return -Infinity
    case 'before':
      return e.startTime
    case 'after':
      return e.endTime
    case 'screencast-frame':
      return e.timestamp
    case 'frame-snapshot':
      return e.snapshot.timestamp
    case 'console':
      return e.time
    case 'stdout':
    case 'stderr':
      return e.timestamp
  }
}

/** At the same timestamp T: an action's `after` ends first, then the
 *  snapshot captured at the action boundary, then console output observed
 *  at the boundary, then the next action's `before`. Matches the viewer's
 *  expectation that the screencast frame shows the state between the
 *  previous action's completion and the next one's start. */
function eventOrder(e: TraceEvent): number {
  switch (e.type) {
    case 'context-options':
      return 0
    case 'after':
      return 1
    case 'screencast-frame':
    case 'frame-snapshot':
      return 2
    case 'console':
    case 'stdout':
    case 'stderr':
      return 3
    case 'before':
      return 4
  }
}

function compareEvents(a: TraceEvent, b: TraceEvent): number {
  const dt = eventTime(a) - eventTime(b)
  return dt !== 0 ? dt : eventOrder(a) - eventOrder(b)
}

/**
 * Generate a human/LLM-readable Markdown transcript from captured commands.
 */
function generateTranscript(
  commands: CommandLog[],
  startWallTime: number,
  title?: string
): string {
  const wallTimeISO = new Date(startWallTime).toISOString()
  const lines: string[] = [`# ${title ?? 'Session'} — ${wallTimeISO}`, '']

  const captured: { entry: CommandLog; action: TraceAction }[] = []
  for (const c of commands) {
    const action = mapCommandToAction(String(c.command))
    if (action) {
      captured.push({ entry: c, action })
    }
  }

  captured.forEach(({ entry, action }, idx) => {
    const label = formatActionTitle(action, entry.args as unknown[])

    const rawArgs = entry.args as unknown[]
    const parts: string[] = [`${idx + 1}. ${label}`]

    if (FILL_METHODS.has(action.method) && rawArgs) {
      const valueIdx = rawArgs.length >= 2 ? 1 : 0
      if (rawArgs[valueIdx] !== undefined) {
        parts.push(`value="${String(rawArgs[valueIdx])}"`)
      }
    }

    if (entry.error) {
      const msg =
        typeof entry.error === 'object' && 'message' in entry.error
          ? (entry.error as { message: string }).message
          : String(entry.error)
      parts.push(`ERROR: ${msg}`)
    }

    lines.push(parts.join('  '))
  })

  return lines.join('\n')
}

interface TraceBundle {
  traceNdjson: string
  networkNdjson: Buffer
  transcriptMd: string
  resources: TraceZipResource[]
}

function buildEventStream(
  trace: TraceLog,
  ctxOptions: ContextOptionsEvent,
  pageId: string,
  wallTime: number,
  testMetadata?: TestMetadataMap,
  denseFrameEvents: ScreencastFrameEvent[] = []
): TraceEvent[] {
  const viewport = trace.metadata.viewport ?? { width: 1280, height: 720 }
  const snapshots = trace.actionSnapshots ?? []
  const snapshotIndex = new FrameSnapshotIndex(snapshots)
  const events: TraceEvent[] = [
    ctxOptions,
    ...buildFilmstripEvents(snapshots, pageId, wallTime, viewport),
    ...denseFrameEvents,
    ...buildActionEvents(
      trace.commands,
      pageId,
      wallTime,
      testMetadata,
      snapshotIndex
    ),
    ...buildImageFrameSnapshots(
      snapshotIndex.refs(),
      pageId,
      wallTime,
      viewport
    ),
    ...buildConsoleEvents(trace.consoleLogs, pageId, wallTime)
  ]
  events.sort(compareEvents)
  return events
}

function buildTraceBundle(
  trace: TraceLog,
  opts: {
    sessionId?: string
    wallTimeOverride?: number
    testMetadata?: TestMetadataMap
  } = {}
): TraceBundle {
  // wallTime anchors monotonic offsets at the first captured command so
  // subsequent actions render at positive deltas in the trace viewer.
  const firstCommandTs = trace.commands[0]?.timestamp
  const wallTime = opts.wallTimeOverride ?? firstCommandTs ?? Date.now()
  const idPrefix = shortId(opts.sessionId)
  const contextId = `context@${idPrefix}`
  const pageId = `page@${idPrefix}`
  const ctxOptions = buildContextOptions(trace, contextId, wallTime)
  const dense = buildDenseScreencast(
    trace.screencastFrames ?? [],
    pageId,
    wallTime,
    trace.metadata.viewport ?? { width: 1280, height: 720 }
  )
  const events = buildEventStream(
    trace,
    ctxOptions,
    pageId,
    wallTime,
    opts.testMetadata,
    dense.events
  )
  const networkBodies = buildNetworkBodyResources(trace.networkRequests)
  return {
    traceNdjson: events.map((e) => JSON.stringify(e)).join('\n') + '\n',
    networkNdjson: buildNetworkNdjson(
      trace.networkRequests,
      wallTime,
      pageId,
      networkBodies.sha1ByRequestId
    ),
    transcriptMd: generateTranscript(
      trace.commands,
      wallTime,
      ctxOptions.title
    ),
    resources: [
      ...buildSnapshotResources(trace.actionSnapshots ?? [], pageId),
      ...dense.resources,
      ...buildSourceResources(trace.sources),
      ...networkBodies.resources
    ]
  }
}

export async function exportTraceZip(
  trace: TraceLog,
  opts: {
    sessionId?: string
    wallTimeOverride?: number
    testMetadata?: TestMetadataMap
  } = {}
): Promise<Buffer> {
  const bundle = buildTraceBundle(trace, opts)
  return buildTraceZip({
    traceNdjson: bundle.traceNdjson,
    networkNdjson: bundle.networkNdjson,
    resources: bundle.resources,
    transcriptMd: bundle.transcriptMd
  })
}

async function exportTraceDirectory(
  trace: TraceLog,
  targetDir: string,
  opts: {
    sessionId?: string
    wallTimeOverride?: number
    testMetadata?: TestMetadataMap
  } = {}
): Promise<void> {
  const bundle = buildTraceBundle(trace, opts)
  await fs.mkdir(path.join(targetDir, 'resources'), { recursive: true })
  await Promise.all([
    fs.writeFile(path.join(targetDir, 'trace.trace'), bundle.traceNdjson),
    fs.writeFile(
      path.join(targetDir, 'transcript.md'),
      bundle.transcriptMd,
      'utf8'
    ),
    bundle.networkNdjson.length
      ? fs.writeFile(
          path.join(targetDir, 'trace.network'),
          bundle.networkNdjson
        )
      : Promise.resolve(),
    ...bundle.resources.map((r) =>
      fs.writeFile(path.join(targetDir, 'resources', r.resourceName), r.data)
    )
  ])
}

/** Minimum capturer surface needed to assemble a TraceLog. */
export interface TraceCapturer {
  mutations: TraceMutation[]
  traceLogs: string[]
  consoleLogs: ConsoleLog[]
  networkRequests: NetworkRequest[]
  commandsLog: CommandLog[]
  sources: Map<string, string>
  metadata?: Metadata
  startWallTime?: number
}

export interface WriteTraceZipOptions {
  outputDir: string
  sessionId: string
  capabilities?: unknown
  /**
   * Per-action snapshots from a Phase-3-style hook. When omitted, snapshots
   * are synthesized from CommandLog entries that carry a screenshot so the
   * viewer still renders thumbnails for adapters without an action hook.
   */
  actionSnapshots?: ActionSnapshot[]
  /** Dense screencast frames for the filmstrip. Thinned + content-addressed at
   *  export time; adapters pass the slice's windowed frames (or all, session
   *  scope). Omitted → no dense filmstrip (byte-stable with today's output). */
  screencastFrames?: readonly ScreencastFrame[]
  /** Output layout — `zip` (default) writes a single archive, `directory`
   *  unpacks the same files into `trace-<id>/`. */
  format?: TraceFormat
  /** Test metadata keyed by testUid for Tracing.tracingGroup events. */
  testMetadata?: TestMetadataMap
  /** Base name for the artifact (zip file stem / directory name). Defaults to
   *  `trace-<sessionId>`; per-test slices pass `'trace'` inside a named folder. */
  fileStem?: string
}

/**
 * Build a TraceLog from a SessionCapturer-shaped source and write the trace
 * artifact (zip file or directory). Returns the absolute path written.
 */
export async function writeTraceZip(
  capturer: TraceCapturer,
  opts: WriteTraceZipOptions
): Promise<string> {
  const baseMetadata = capturer.metadata ?? ({} as Metadata)
  const actionSnapshots =
    opts.actionSnapshots ??
    synthesizeSnapshotsFromCommands(capturer.commandsLog)
  const traceLog: TraceLog = {
    mutations: capturer.mutations,
    logs: capturer.traceLogs,
    consoleLogs: capturer.consoleLogs,
    networkRequests: capturer.networkRequests,
    metadata: {
      ...baseMetadata,
      ...(opts.capabilities
        ? { capabilities: opts.capabilities as Metadata['capabilities'] }
        : {})
    },
    commands: capturer.commandsLog,
    sources: Object.fromEntries(capturer.sources),
    ...(actionSnapshots.length ? { actionSnapshots } : {}),
    ...(opts.screencastFrames?.length
      ? { screencastFrames: [...opts.screencastFrames] }
      : {})
  }
  await fs.mkdir(opts.outputDir, { recursive: true })
  const exportOpts = {
    sessionId: opts.sessionId,
    wallTimeOverride: capturer.startWallTime,
    testMetadata: opts.testMetadata
  }
  const stem = opts.fileStem ?? `trace-${opts.sessionId}`
  if (opts.format === 'ndjson-directory') {
    const dir = path.join(opts.outputDir, stem)
    await fs.mkdir(dir, { recursive: true })
    await exportTraceDirectory(traceLog, dir, exportOpts)
    return dir
  }
  const zip = await exportTraceZip(traceLog, exportOpts)
  const zipPath = path.join(opts.outputDir, `${stem}.zip`)
  await fs.writeFile(zipPath, zip)
  return zipPath
}

function synthesizeSnapshotsFromCommands(
  commands: CommandLog[]
): ActionSnapshot[] {
  return commands
    .filter((c) => c.screenshot && mapCommandToAction(c.command))
    .map((c) => ({
      timestamp: c.timestamp,
      command: c.command,
      screenshot: c.screenshot
    }))
}
