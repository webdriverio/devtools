// Reads a standard-format trace.zip back into a player payload. Accepts our
// own exporter's output (core/trace-exporter.ts) and foreign zips: every
// entry ending in `.trace` is an action-event stream (foreign tools write
// `test.trace` plus per-context `0-trace.trace`, ...), every `.network` entry
// is a HAR stream, and `.stacks` sidecars carry call stacks. Commands come
// from before/after events, the filmstrip from screencast-frame events +
// resources/*, console logs from console/stdio events, sources from stack
// frames + src@ resources, and DOM mutations from the `.mutations` stream when
// present. Fields the zip never carried (suites) come back empty. Constants,
// event types, and pure helpers live in the sibling
// trace-reader-{constants,types,utils}.ts files.

import fs from 'node:fs/promises'
import { unzipSync, strFromU8 } from 'fflate'
import {
  isMutationsTruncationMarker,
  type CommandLog,
  type NetworkRequest,
  type TraceLog,
  type TraceMutation,
  type TracePlayerData,
  type TracePlayerFrame
} from '@wdio/devtools-shared'

import {
  FRAME_RESOURCE_SUFFIXES,
  MUTATIONS_STREAM_SUFFIX,
  NETWORK_STREAM_SUFFIX,
  REVERSE_ACTION_MAP,
  STACKS_STREAM_SUFFIX,
  TRACE_STREAM_SUFFIX
} from './trace-reader-constants.js'
import type {
  AfterEvent,
  BeforeEvent,
  CategorizedEvents,
  ConsoleEvent,
  ContextOptionsEvent,
  HarSnapshot,
  MergedEvents,
  ScreencastFrameEvent,
  StdioEvent
} from './trace-reader-types.js'
import {
  buildActionTree,
  collectStructuralIds,
  isStructuralBefore
} from './trace-reader-groups.js'
import {
  actionLabel,
  attachSidecarStacks,
  buildConsoleLogs,
  buildMetadata,
  buildSources,
  harToNetworkRequest,
  nearestFrame,
  paramsToArgs,
  parseNdjson,
  stackToCallSource
} from './trace-reader-utils.js'

function categorizeEvents(
  events: Record<string, unknown>[]
): CategorizedEvents {
  const befores = new Map<string, BeforeEvent>()
  const afters = new Map<string, AfterEvent>()
  const frameEvents: ScreencastFrameEvent[] = []
  const consoleEvents: (ConsoleEvent | StdioEvent)[] = []
  let ctx: ContextOptionsEvent | undefined
  for (const event of events) {
    switch (event.type) {
      case 'context-options':
        ctx = event as unknown as ContextOptionsEvent
        break
      case 'before': {
        const before = event as unknown as BeforeEvent
        befores.set(before.callId, before)
        break
      }
      case 'after': {
        const after = event as unknown as AfterEvent
        afters.set(after.callId, after)
        break
      }
      case 'screencast-frame':
        frameEvents.push(event as unknown as ScreencastFrameEvent)
        break
      case 'console':
      case 'stdout':
      case 'stderr':
        consoleEvents.push(event as unknown as ConsoleEvent | StdioEvent)
        break
    }
  }
  return { ctx, befores, afters, frameEvents, consoleEvents }
}

// Anchors both encodings: our offsets (monotonicTime 0 → anchor = wallTime)
// and foreign monotonic readings (anchor = wallTime - monotonicTime).
function rebaseToEpoch(stream: CategorizedEvents): void {
  const ctx = stream.ctx
  const anchor = ctx ? ctx.wallTime - (ctx.monotonicTime ?? 0) : 0
  if (anchor === 0) {
    return
  }
  for (const before of stream.befores.values()) {
    before.startTime += anchor
  }
  for (const after of stream.afters.values()) {
    after.endTime += anchor
  }
  for (const frame of stream.frameEvents) {
    frame.timestamp += anchor
  }
  for (const event of stream.consoleEvents) {
    if (event.type === 'console') {
      event.time += anchor
    } else {
      event.timestamp += anchor
    }
  }
}

function mergeStreams(streams: CategorizedEvents[]): MergedEvents {
  const merged: MergedEvents = {
    ctxs: [],
    befores: new Map(),
    afters: new Map(),
    frameEvents: [],
    consoleEvents: []
  }
  for (const stream of streams) {
    if (stream.ctx) {
      merged.ctxs.push(stream.ctx)
    }
    for (const [callId, before] of stream.befores) {
      merged.befores.set(callId, before)
    }
    for (const [callId, after] of stream.afters) {
      merged.afters.set(callId, after)
    }
    merged.frameEvents.push(...stream.frameEvents)
    merged.consoleEvents.push(...stream.consoleEvents)
  }
  return merged
}

function frameResource(
  files: Record<string, Uint8Array>,
  sha1: string
): Uint8Array | undefined {
  for (const suffix of FRAME_RESOURCE_SUFFIXES) {
    const data = files[`resources/${sha1}${suffix}`]
    if (data) {
      return data
    }
  }
  return undefined
}

function buildFrames(
  files: Record<string, Uint8Array>,
  frameEvents: ScreencastFrameEvent[]
): { frames: TracePlayerFrame[]; maxTime: number } {
  const frames: TracePlayerFrame[] = []
  let maxTime = 0
  for (const event of frameEvents) {
    const data = frameResource(files, event.sha1)
    if (!data) {
      continue
    }
    frames.push({
      timestamp: event.timestamp,
      screenshot: Buffer.from(data).toString('base64')
    })
    maxTime = Math.max(maxTime, event.timestamp)
  }
  frames.sort((a, b) => a.timestamp - b.timestamp)
  return { frames, maxTime }
}

// Foreign runner streams may record a failure only on the wrapper step a
// library call renders under; surface it on the visible command row.
function commandError(
  before: BeforeEvent,
  after: AfterEvent | undefined,
  afters: Map<string, AfterEvent>
): { message: string } | undefined {
  if (after?.error) {
    return after.error
  }
  if (before.stepId && before.stepId !== before.callId) {
    return afters.get(before.stepId)?.error
  }
  return undefined
}

/** Reconstruct one CommandLog from its before/after events + nearest frame. */
function reconstructCommand(
  before: BeforeEvent,
  after: AfterEvent | undefined,
  afters: Map<string, AfterEvent>,
  frames: TracePlayerFrame[]
): CommandLog {
  const endTime = after?.endTime ?? before.startTime
  const command: CommandLog = {
    command:
      REVERSE_ACTION_MAP[`${before.class}.${before.method}`] ?? before.method,
    args: paramsToArgs(before.params),
    // Show the trace-style label (`Element.fill("x")`); the command name above
    // still drives the UI's category colour and icon.
    title:
      before.title ?? actionLabel(before.class, before.method, before.params),
    startTime: before.startTime,
    timestamp: endTime
  }
  const error = commandError(before, after, afters)
  if (error) {
    command.error = { name: 'Error', message: error.message }
  }
  if (after?.result !== undefined) {
    command.result = after.result
  }
  const callSource = stackToCallSource(before.stack)
  if (callSource) {
    command.callSource = callSource
  }
  const frame = nearestFrame(frames, command.timestamp)
  if (frame) {
    command.screenshot = frame.screenshot
  }
  return command
}

function buildCommands(
  events: MergedEvents,
  frames: TracePlayerFrame[]
): {
  commands: CommandLog[]
  maxTime: number
  indexByCallId: Map<string, number>
} {
  const entries: { callId: string; command: CommandLog }[] = []
  const structural = collectStructuralIds(events.befores)
  let maxTime = 0
  for (const [callId, before] of events.befores) {
    // Group markers are structure, not actions — as command rows their end
    // timestamp ties with the last action and steals the active highlight.
    if (isStructuralBefore(before, structural)) {
      continue
    }
    const after = events.afters.get(callId)
    const command = reconstructCommand(before, after, events.afters, frames)
    maxTime = Math.max(maxTime, command.timestamp)
    entries.push({ callId, command })
  }
  entries.sort((a, b) => a.command.timestamp - b.command.timestamp)
  return {
    commands: entries.map((entry) => entry.command),
    maxTime,
    indexByCallId: new Map(entries.map((entry, index) => [entry.callId, index]))
  }
}

function parseNetworkStreams(
  files: Record<string, Uint8Array>,
  names: string[]
): NetworkRequest[] {
  return names
    .flatMap((name) => parseNdjson(strFromU8(files[name])))
    .filter((entry) => typeof entry.snapshot === 'object' && entry.snapshot)
    .map((entry, index) =>
      harToNetworkRequest(entry.snapshot as HarSnapshot, index, files)
    )
}

function parseMutationStreams(
  files: Record<string, Uint8Array>,
  names: string[]
): TraceMutation[] {
  // The `.mutations` NDJSON is TraceMutation JSON, minus the trailing
  // truncation marker; cast at this boundary like the HAR/action parsers.
  return names
    .flatMap((name) => parseNdjson(strFromU8(files[name])))
    .filter(
      (entry) => !isMutationsTruncationMarker(entry)
    ) as unknown as TraceMutation[]
}

/** Categorize + rebase every `.trace` action stream, merge them, and fold in
 *  any `.stacks` sidecars — the event-stream prelude for `parseTraceZip`. */
function parseAndMergeEventStreams(
  files: Record<string, Uint8Array>,
  names: string[]
): MergedEvents {
  const streams = names
    .filter((name) => name.endsWith(TRACE_STREAM_SUFFIX))
    .map((name) => {
      const stream = categorizeEvents(parseNdjson(strFromU8(files[name])))
      rebaseToEpoch(stream)
      return stream
    })
  const merged = mergeStreams(streams)
  for (const name of names.filter((n) => n.endsWith(STACKS_STREAM_SUFFIX))) {
    attachSidecarStacks(merged.befores, strFromU8(files[name]))
  }
  return merged
}

function earliestWallTime(ctxs: ContextOptionsEvent[]): number {
  const wallTimes = ctxs
    .map((ctx) => ctx.wallTime)
    .filter((time) => Number.isFinite(time))
  return wallTimes.length ? Math.min(...wallTimes) : 0
}

/** Parse an in-memory trace.zip buffer into a player payload. Pure (no I/O). */
export function parseTraceZip(zip: Uint8Array): TracePlayerData {
  const files = unzipSync(zip)
  const names = Object.keys(files).sort()
  const entriesWith = (suffix: string) =>
    names.filter((name) => name.endsWith(suffix))
  const merged = parseAndMergeEventStreams(files, names)
  const { frames, maxTime: frameMax } = buildFrames(files, merged.frameEvents)
  const {
    commands,
    maxTime: cmdMax,
    indexByCallId
  } = buildCommands(merged, frames)
  const groups = buildActionTree(
    merged.befores,
    merged.afters,
    commands,
    indexByCallId
  )
  const startTime = earliestWallTime(merged.ctxs)
  const transcript = files['transcript.md']
    ? strFromU8(files['transcript.md'])
    : undefined
  const trace: TraceLog = {
    mutations: parseMutationStreams(
      files,
      entriesWith(MUTATIONS_STREAM_SUFFIX)
    ),
    logs: [],
    consoleLogs: buildConsoleLogs(merged.consoleEvents),
    networkRequests: parseNetworkStreams(
      files,
      entriesWith(NETWORK_STREAM_SUFFIX)
    ),
    metadata: buildMetadata(
      merged.ctxs.find((ctx) => ctx.browserName) ?? merged.ctxs[0]
    ),
    commands,
    sources: buildSources(merged.befores.values(), files),
    suites: []
  }
  return {
    trace,
    frames,
    startTime,
    duration: Math.max(0, Math.max(frameMax, cmdMax) - startTime),
    ...(groups ? { groups } : {}),
    ...(transcript ? { transcript } : {})
  }
}

/** Read a trace.zip from disk and reconstruct the player payload. */
export async function readTraceZip(zipPath: string): Promise<TracePlayerData> {
  const buffer = await fs.readFile(zipPath)
  return parseTraceZip(new Uint8Array(buffer))
}
