// Reads a standard-format trace.zip back into a player payload. Accepts our
// own exporter's output (trace-exporter.ts) and foreign zips: every
// entry ending in `.trace` is an action-event stream (foreign tools write
// `test.trace` plus per-context `0-trace.trace`, ...), every `.network` entry
// is a HAR stream, and `.stacks` sidecars carry call stacks. Commands come
// from before/after events, the filmstrip from screencast-frame events +
// resources/*, console logs from console/stdio events, sources from stack
// frames + src@ resources, and DOM mutations from the `.mutations` stream when
// present. Fields the zip never carried (suites) come back empty. Images,
// stored bodies and page resources are named by entry, never read here: the
// player reads each one from the zip when it shows it. Constants, event types,
// and pure helpers live in the sibling trace-reader-{constants,types,utils,
// groups}.ts files.

import { unzipSync, strFromU8 } from 'fflate'
import {
  imageBytesDimensions,
  isMutationsTruncationMarker,
  TRACE_ZIP_ENTRIES,
  type CommandLog,
  type NetworkRequest,
  type TraceLog,
  type TraceMutation,
  type TracePlayerData,
  type TracePlayerFrame
} from '@wdio/devtools-shared'

import { pageResourcesOf } from './trace-reader-page-resources.js'
import {
  openZip,
  ZIP_MAX_INFLATED_BYTES,
  type ZipIndex,
  type ZipSource
} from './zip-index.js'

// The app may import only this module from `trace`, so the sources it opens a zip over come through it.
export { blobZipSource, bytesZipSource, type ZipSource } from './zip-index.js'
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
  FrameSnapshotEvent,
  HarSnapshot,
  MergedEvents,
  ScreencastFrameEvent,
  StdioEvent,
  TraceEntries,
  TraceZipEntries
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
  paramsToArgs,
  responseBodyEntry,
  parseNdjson,
  stackToCallSource
} from './trace-reader-utils.js'

function categorizeEvents(
  events: Record<string, unknown>[]
): CategorizedEvents {
  const befores = new Map<string, BeforeEvent>()
  const afters = new Map<string, AfterEvent>()
  const frameEvents: ScreencastFrameEvent[] = []
  const frameSnapshots: FrameSnapshotEvent[] = []
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
      case 'frame-snapshot':
        frameSnapshots.push(event as unknown as FrameSnapshotEvent)
        break
      case 'console':
      case 'stdout':
      case 'stderr':
        consoleEvents.push(event as unknown as ConsoleEvent | StdioEvent)
        break
    }
  }
  return { ctx, befores, afters, frameEvents, frameSnapshots, consoleEvents }
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
    frameSnapshots: [],
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
    merged.frameSnapshots.push(...stream.frameSnapshots)
    merged.consoleEvents.push(...stream.consoleEvents)
  }
  return merged
}

function frameResource(
  names: ReadonlySet<string>,
  sha1: string
): string | undefined {
  return FRAME_RESOURCE_SUFFIXES.map(
    (suffix) => `resources/${sha1}${suffix}`
  ).find((name) => names.has(name))
}

function buildFrames(
  names: ReadonlySet<string>,
  frameEvents: ScreencastFrameEvent[]
): { frames: TracePlayerFrame[]; maxTime: number } {
  const frames: TracePlayerFrame[] = []
  let maxTime = 0
  for (const event of frameEvents) {
    const entry = frameResource(names, event.sha1)
    if (!entry) {
      continue
    }
    frames.push({ timestamp: event.timestamp, entry })
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
  const own = after?.error ?? after?.retriedError
  if (own) {
    return own
  }
  if (before.stepId && before.stepId !== before.callId) {
    return afters.get(before.stepId)?.error
  }
  return undefined
}

/** Reconstruct one CommandLog from its before/after events; its image is the player's `nearestFrame`. */
function reconstructCommand(
  before: BeforeEvent,
  after: AfterEvent | undefined,
  afters: Map<string, AfterEvent>,
  snapshotText?: string
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
  if (snapshotText) {
    command.snapshotText = snapshotText
  }
  if (after?.point) {
    command.point = after.point
  }
  const locator = before.params?.locator
  if (typeof locator === 'string') {
    command.selector = locator
  }
  return command
}

/** Resolve each per-action `-snapshot.txt` (a11y tree) resource, keyed by the
 *  command's callId. The frame-snapshot event names the resource via its pageId
 *  + original timestamp (wallTime), so this works regardless of whether the zip
 *  used the sparse or dense filmstrip. */
function buildSnapshotTextByCallId(
  files: TraceZipEntries,
  frameSnapshots: FrameSnapshotEvent[]
): Map<string, string> {
  const byCallId = new Map<string, string>()
  for (const { snapshot } of frameSnapshots) {
    const data =
      files[`resources/${snapshot.pageId}-${snapshot.wallTime}-snapshot.txt`]
    if (data) {
      byCallId.set(snapshot.callId, strFromU8(data))
    }
  }
  return byCallId
}

function buildCommands(
  events: MergedEvents,
  files: TraceZipEntries
): {
  commands: CommandLog[]
  maxTime: number
  indexByCallId: Map<string, number>
} {
  const entries: { callId: string; command: CommandLog }[] = []
  const structural = collectStructuralIds(events.befores)
  const snapshotByCallId = buildSnapshotTextByCallId(
    files,
    events.frameSnapshots
  )
  let maxTime = 0
  for (const [callId, before] of events.befores) {
    // Group markers are structure, not actions — as command rows their end
    // timestamp ties with the last action and steals the active highlight.
    if (isStructuralBefore(before, structural)) {
      continue
    }
    const after = events.afters.get(callId)
    const command = reconstructCommand(
      before,
      after,
      events.afters,
      snapshotByCallId.get(callId)
    )
    command.callId = callId
    maxTime = Math.max(maxTime, command.timestamp)
    entries.push({ callId, command })
  }
  entries.sort((a, b) => a.command.timestamp - b.command.timestamp)
  const indexByCallId = new Map(
    entries.map((entry, index) => [entry.callId, index])
  )
  linkIssuedRows(entries, events.befores, indexByCallId)
  return {
    commands: entries.map((entry) => entry.command),
    maxTime,
    indexByCallId
  }
}

/** Restore `id`/`parentId` between action rows, so the shared helpers that judge a row by the row that issued it read a trace as they read a live run. */
function linkIssuedRows(
  entries: { callId: string; command: CommandLog }[],
  befores: Map<string, BeforeEvent>,
  indexByCallId: Map<string, number>
): void {
  for (const { callId, command } of entries) {
    const parentCallId = befores.get(callId)?.parentId
    const parent =
      parentCallId === undefined ? undefined : indexByCallId.get(parentCallId)
    if (parent !== undefined) {
      entries[parent].command.id = parent
      command.parentId = parent
    }
  }
}

function parseNetworkStreams(
  { names, entries }: TraceEntries,
  streams: string[]
): Pick<TracePlayerData, 'responseBodies'> & {
  requests: NetworkRequest[]
} {
  const responseBodies: Record<string, string> = {}
  const requests = streams
    .flatMap((name) => parseNdjson(strFromU8(entries[name])))
    .filter((entry) => typeof entry.snapshot === 'object' && entry.snapshot)
    .map((entry, index) => {
      const snapshot = entry.snapshot as HarSnapshot
      const request = harToNetworkRequest(snapshot, index)
      const body = responseBodyEntry(snapshot, names)
      if (body && request.responseBody === undefined) {
        responseBodies[request.id] = body
      }
      return request
    })
  return Object.keys(responseBodies).length
    ? { requests, responseBodies }
    : { requests }
}

function parseMutationStreams(
  files: TraceZipEntries,
  names: string[]
): TraceMutation[] {
  // The `.mutations` NDJSON is TraceMutation JSON, minus the trailing
  // truncation marker; cast at this boundary like the HAR/action parsers.
  // Timestamps stay as written: they are page-side absolute wall ms, which is
  // the same timebase `rebaseToEpoch` puts the action streams on.
  return names
    .flatMap((name) => parseNdjson(strFromU8(files[name])))
    .filter(
      (entry) => !isMutationsTruncationMarker(entry)
    ) as unknown as TraceMutation[]
}

/** Categorize + rebase every `.trace` action stream, merge them, and fold in
 *  any `.stacks` sidecars — the event-stream prelude for `parseTraceZip`. */
function parseAndMergeEventStreams(
  files: TraceZipEntries,
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

/** Entries the payload is built from; frame images, stored bodies and page resources are read only when shown. */
export function isEagerEntry(name: string): boolean {
  const prefix = `${TRACE_ZIP_ENTRIES.resourcesDir}/`
  if (!name.startsWith(prefix)) {
    return true
  }
  const resource = name.slice(prefix.length)
  return resource.startsWith('src@') || resource.endsWith('-snapshot.txt')
}

/** A trace zip opened for reading: every entry name, and any entry's bytes on demand. */
export type TraceArchive = ZipIndex

/** Indexes a trace zip from its central directory, reading no entry yet. */
export function openTraceArchive(source: ZipSource): Promise<TraceArchive> {
  return openZip(source)
}

/** Eager entries inflated at once; a zip holds few, so this only bounds a hostile one. */
const EAGER_READ_CONCURRENCY = 8

/** Reads the entries the payload is built from, and nothing else, refusing a zip that declares more than a reader inflates at once. */
export async function readTraceEntries(
  archive: TraceArchive
): Promise<TraceEntries> {
  const eager = [...archive.names].filter(isEagerEntry)
  const declared = eager.reduce(
    (total, name) => total + (archive.sizeOf(name) ?? 0),
    0
  )
  if (declared > ZIP_MAX_INFLATED_BYTES) {
    throw new Error('The trace declares more data than the player reads')
  }
  const entries: TraceZipEntries = {}
  for (let at = 0; at < eager.length; at += EAGER_READ_CONCURRENCY) {
    const batch = eager.slice(at, at + EAGER_READ_CONCURRENCY)
    const read = await Promise.all(batch.map((name) => archive.read(name)))
    batch.forEach((name, i) => (entries[name] = read[i]!))
  }
  return { names: archive.names, entries }
}

/** The first frame's pixel size, and the largest frame's declared length, which bounds how many frames the player holds at once. */
function withFrameSize(
  data: TracePlayerData,
  firstFrame: Uint8Array | undefined,
  sizeOf: (entry: string) => number | undefined
): TracePlayerData {
  const largest = Math.max(
    0,
    ...data.frames.map(({ entry }) => sizeOf(entry) ?? 0)
  )
  const size = firstFrame && imageBytesDimensions(firstFrame)
  return {
    ...data,
    ...(largest ? { frameBytes: largest } : {}),
    ...(size ? { frameSize: size } : {})
  }
}

/** The payload, plus the first frame's size read from its own entry. */
export async function buildTracePayload(
  entries: TraceEntries,
  archive: TraceArchive
): Promise<TracePlayerData> {
  const data = parseTraceEntries(entries)
  const first = data.frames[0]
  // An unreadable image costs the filmstrip its shape, never the whole trace.
  const image =
    first && (await archive.read(first.entry).catch(() => undefined))
  return withFrameSize(data, image, (entry) => archive.sizeOf(entry))
}

/** Opens nothing but the payload's entries and one frame of a trace zip. */
export async function readTracePayload(
  archive: TraceArchive
): Promise<TracePlayerData> {
  return buildTracePayload(await readTraceEntries(archive), archive)
}

/** Parse an in-memory trace.zip buffer into a player payload, inflating only the entries `isEagerEntry` names. Pure (no I/O). */
export function parseTraceZip(zip: Uint8Array): TracePlayerData {
  const sizes = new Map<string, number>()
  const entries = unzipSync(zip, {
    filter: ({ name, originalSize }) => {
      sizes.set(name, originalSize)
      return isEagerEntry(name)
    }
  })
  const data = parseTraceEntries({ names: new Set(sizes.keys()), entries })
  const first = data.frames[0]?.entry
  return withFrameSize(
    data,
    first
      ? unzipSync(zip, { filter: ({ name }) => name === first })[first]
      : undefined,
    (entry) => sizes.get(entry)
  )
}

/** Build the player payload from a trace.zip's entry names and the bytes of its eager entries. */
export function parseTraceEntries(files: TraceEntries): TracePlayerData {
  const { names, entries } = files
  const sorted = [...names].filter(isEagerEntry).sort()
  const entriesWith = (suffix: string) =>
    sorted.filter((name) => name.endsWith(suffix))
  const merged = parseAndMergeEventStreams(entries, sorted)
  const { frames, maxTime: frameMax } = buildFrames(names, merged.frameEvents)
  const built = buildCommands(merged, entries)
  const { commands } = built
  const groups = buildActionTree(
    merged.befores,
    merged.afters,
    commands,
    built.indexByCallId
  )
  const startTime = earliestWallTime(merged.ctxs)
  const transcriptEntry = entries[TRACE_ZIP_ENTRIES.transcript]
  const transcript = transcriptEntry && strFromU8(transcriptEntry)
  const network = parseNetworkStreams(files, entriesWith(NETWORK_STREAM_SUFFIX))
  const pageResources = pageResourcesOf(files)
  const trace: TraceLog = {
    mutations: parseMutationStreams(
      entries,
      entriesWith(MUTATIONS_STREAM_SUFFIX)
    ),
    logs: [],
    consoleLogs: buildConsoleLogs(merged.consoleEvents),
    networkRequests: network.requests,
    metadata: buildMetadata(
      merged.ctxs.find((ctx) => ctx.browserName) ?? merged.ctxs[0]
    ),
    commands,
    sources: buildSources(merged.befores.values(), entries),
    suites: []
  }
  return {
    trace,
    frames,
    startTime,
    duration: Math.max(0, Math.max(frameMax, built.maxTime) - startTime),
    ...withoutAbsent({
      responseBodies: network.responseBodies,
      pageResources: pageResources.length ? pageResources : undefined,
      groups,
      transcript: transcript || undefined
    })
  }
}

/** `fields` without the ones that are undefined, so a zip that carried none leaves no key. */
function withoutAbsent<T extends object>(fields: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined)
  ) as Partial<T>
}
