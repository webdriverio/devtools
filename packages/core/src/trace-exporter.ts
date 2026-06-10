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
  TraceFormat,
  TraceLog,
  TraceMutation
} from '@wdio/devtools-shared'
import {
  formatActionTitle,
  mapCommandToAction,
  FILL_METHODS
} from './action-mapping.js'
import { networkRequestToHar } from './trace-har.js'
import { buildTraceZip, type TraceZipResource } from './trace-zip-writer.js'

const TRACE_VERSION = 8
const LIBRARY_NAME = '@wdio/devtools-core'
const LIBRARY_VERSION = '1.0.0'

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

interface BeforeEvent {
  type: 'before'
  callId: string
  startTime: number
  class: string
  method: string
  pageId: string
  params: Record<string, unknown>
  title: string
}

interface AfterEvent {
  type: 'after'
  callId: string
  endTime: number
  error?: { message: string }
}

interface ScreencastFrameEvent {
  type: 'screencast-frame'
  pageId: string
  sha1: string
  elements?: string
  snapshot?: string
  width: number
  height: number
  timestamp: number
}

type TraceEvent =
  | ContextOptionsEvent
  | BeforeEvent
  | AfterEvent
  | ScreencastFrameEvent

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

function buildActionEvents(
  commands: CommandLog[],
  pageId: string,
  wallTime: number
): TraceEvent[] {
  const events: TraceEvent[] = []
  let prevEndMs = 0
  let callCounter = 0
  for (const cmd of commands) {
    const action = mapCommandToAction(cmd.command)
    if (!action) {
      continue
    }
    callCounter++
    const callId = `call@${callCounter}`
    // Use the command's actual invocation timestamp for the start, falling
    // back to the completion timestamp when startTime isn't recorded.
    const rawStartMs = (cmd.startTime ?? cmd.timestamp) - wallTime
    const rawEndMs = cmd.timestamp - wallTime
    // Floor at prevEndMs to prevent visual overlap with previous action.
    const startMs = Math.max(prevEndMs, rawStartMs)
    // +1ms minimum duration so the viewer never sees an `after` whose
    // matching `before` hasn't been parsed yet.
    const endMs = Math.max(startMs + 1, rawEndMs)
    const rawArgs = cmd.args as unknown[]
    let params: Record<string, unknown>
    if (
      action.class === 'Element' &&
      action.method === 'fill' &&
      rawArgs.length >= 2
    ) {
      params = { selector: rawArgs[0], value: rawArgs[1] }
    } else if (
      action.class === 'Element' &&
      action.method === 'fill' &&
      rawArgs.length === 1
    ) {
      params = { value: rawArgs[0] }
    } else if (
      action.class === 'Element' &&
      rawArgs.length === 1 &&
      typeof rawArgs[0] === 'string'
    ) {
      params = { selector: rawArgs[0] }
    } else if (rawArgs.length === 1 && typeof rawArgs[0] === 'string') {
      params = { url: rawArgs[0] }
    } else {
      params = Object.fromEntries(rawArgs.map((a, i) => [String(i), a]))
    }
    events.push({
      type: 'before',
      callId,
      startTime: startMs,
      class: action.class,
      method: action.method,
      pageId,
      params,
      title: formatActionTitle(action, cmd.args, params)
    })
    const afterEvent: AfterEvent = {
      type: 'after',
      callId,
      endTime: endMs
    }
    if (cmd.error) {
      const err = cmd.error as { message?: string }
      afterEvent.error = { message: err.message ?? String(cmd.error) }
    }
    events.push(afterEvent)
    prevEndMs = endMs
  }
  return events
}

function buildNetworkNdjson(
  requests: NetworkRequest[],
  wallTime: number,
  pageId: string
): Buffer {
  if (!requests.length) {
    return Buffer.alloc(0)
  }
  const lines = requests.map((r) => {
    const entry = networkRequestToHar(r) as unknown as Record<string, unknown>
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

function buildSnapshotResources(
  snapshots: ActionSnapshot[],
  pageId: string
): TraceZipResource[] {
  const out: TraceZipResource[] = []
  for (const snap of snapshots) {
    const base = `${pageId}-${snap.timestamp}`
    if (snap.screenshot) {
      out.push({
        resourceName: `${base}.jpeg`,
        data: Buffer.from(snap.screenshot, 'base64')
      })
    }
    if (snap.elements && snap.elements.length) {
      out.push({
        resourceName: `${base}-elements.json`,
        data: Buffer.from(JSON.stringify(snap.elements), 'utf8')
      })
    }
    if (snap.snapshotText) {
      out.push({
        resourceName: `${base}-snapshot.txt`,
        data: Buffer.from(snap.snapshotText, 'utf8')
      })
    }
  }
  return out
}

function buildScreencastFrames(
  snapshots: ActionSnapshot[],
  pageId: string,
  wallTime: number,
  viewport: { width: number; height: number }
): ScreencastFrameEvent[] {
  return snapshots
    .filter((s) => s.screenshot)
    .map((s) => {
      const base = `${pageId}-${s.timestamp}`
      const frame: ScreencastFrameEvent = {
        type: 'screencast-frame',
        pageId,
        sha1: `${base}.jpeg`,
        width: viewport.width,
        height: viewport.height,
        timestamp: Math.max(0, s.timestamp - wallTime)
      }
      if (s.elements && s.elements.length) {
        frame.elements = `${base}-elements.json`
      }
      if (s.snapshotText) {
        frame.snapshot = `${base}-snapshot.txt`
      }
      return frame
    })
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
  }
}

/** At the same timestamp T: an action's `after` ends first, then the
 *  snapshot captured at the action boundary, then the next action's `before`.
 *  Matches the viewer's expectation that the screencast frame shows the
 *  state between the previous action's completion and the next one's start. */
function eventOrder(e: TraceEvent): number {
  switch (e.type) {
    case 'context-options':
      return 0
    case 'after':
      return 1
    case 'screencast-frame':
      return 2
    case 'before':
      return 3
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

  const captured = commands.filter(
    (c) => mapCommandToAction(String(c.command)) !== null
  )

  captured.forEach((entry, idx) => {
    const action = mapCommandToAction(String(entry.command))!
    const label = formatActionTitle(action, entry.args as unknown[])

    const rawArgs = entry.args as unknown[]
    const parts: string[] = [`${idx + 1}. ${label}`]

    if (FILL_METHODS.has(action.method) && rawArgs) {
      const valueIdx = rawArgs.length >= 2 ? 1 : 0
      if (rawArgs[valueIdx] !== undefined) {
        parts.push(`value="${String(rawArgs[valueIdx]).slice(0, 50)}"`)
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

function buildTraceBundle(
  trace: TraceLog,
  opts: {
    sessionId?: string
    wallTimeOverride?: number
  } = {}
): TraceBundle {
  // wallTime anchors monotonic offsets at the first captured command so
  // subsequent actions render at positive deltas in the trace viewer.
  const firstCommandTs = trace.commands[0]?.timestamp
  const wallTime = opts.wallTimeOverride ?? firstCommandTs ?? Date.now()
  const idPrefix = shortId(opts.sessionId)
  const contextId = `context@${idPrefix}`
  const pageId = `page@${idPrefix}`
  const viewport = trace.metadata.viewport ?? { width: 1280, height: 720 }
  const snapshots = trace.actionSnapshots ?? []
  const events: TraceEvent[] = [buildContextOptions(trace, contextId, wallTime)]

  // Emit initial screencast-frame (timestamp=0) using the first snapshot's
  // resources so trace viewers show the page state before any interaction.
  const firstSnap = snapshots.find((s) => s.screenshot)
  if (firstSnap) {
    const base = `${pageId}-${firstSnap.timestamp}`
    const initFrame: ScreencastFrameEvent = {
      type: 'screencast-frame',
      pageId,
      sha1: `${base}.jpeg`,
      width: viewport.width,
      height: viewport.height,
      timestamp: 0
    }
    if (firstSnap.elements && firstSnap.elements.length) {
      initFrame.elements = `${base}-elements.json`
    }
    if (firstSnap.snapshotText) {
      initFrame.snapshot = `${base}-snapshot.txt`
    }
    events.push(initFrame)
  }

  events.push(
    // Skip the first snapshot in buildScreencastFrames — it was already emitted
    // as the initial t=0 frame above.
    ...buildScreencastFrames(
      firstSnap ? snapshots.filter((s) => s !== firstSnap) : snapshots,
      pageId,
      wallTime,
      viewport
    ),
    ...buildActionEvents(trace.commands, pageId, wallTime)
  )
  events.sort(compareEvents)
  const caps = trace.metadata.capabilities as
    | Record<string, unknown>
    | undefined
  const ctxBName = resolveContextNaming(caps).title
  return {
    traceNdjson: events.map((e) => JSON.stringify(e)).join('\n') + '\n',
    networkNdjson: buildNetworkNdjson(trace.networkRequests, wallTime, pageId),
    transcriptMd: generateTranscript(trace.commands, wallTime, ctxBName),
    resources: buildSnapshotResources(snapshots, pageId)
  }
}

export async function exportTraceZip(
  trace: TraceLog,
  opts: {
    sessionId?: string
    wallTimeOverride?: number
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
  /** Output layout — `zip` (default) writes a single archive, `directory`
   *  unpacks the same files into `trace-<id>/`. */
  format?: TraceFormat
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
    ...(actionSnapshots.length ? { actionSnapshots } : {})
  }
  await fs.mkdir(opts.outputDir, { recursive: true })
  const exportOpts = {
    sessionId: opts.sessionId,
    wallTimeOverride: capturer.startWallTime
  }
  if (opts.format === 'ndjson-directory') {
    const dir = path.join(opts.outputDir, `trace-${opts.sessionId}`)
    await fs.mkdir(dir, { recursive: true })
    await exportTraceDirectory(traceLog, dir, exportOpts)
    return dir
  }
  const zip = await exportTraceZip(traceLog, exportOpts)
  const zipPath = path.join(opts.outputDir, `trace-${opts.sessionId}.zip`)
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
