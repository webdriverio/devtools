// Reads a trace.zip produced by core/trace-exporter.ts back into a player
// payload. The writer is the inverse: this reconstructs commands from
// before/after events, the frame filmstrip from screencast-frame events +
// resources/*.jpeg, console logs from console/stdout/stderr events, and
// network requests from the HAR resource-snapshot entries. Fields the zip
// never carried (mutations, sources, suites) come back empty. Constants,
// event types, and pure helpers live in the sibling
// trace-reader-{constants,types,utils}.ts files.

import fs from 'node:fs/promises'
import { unzipSync, strFromU8 } from 'fflate'
import {
  type CommandLog,
  type TraceLog,
  type TracePlayerData,
  type TracePlayerFrame
} from '@wdio/devtools-shared'

import { REVERSE_ACTION_MAP } from './trace-reader-constants.js'
import type {
  AfterEvent,
  BeforeEvent,
  CategorizedEvents,
  ConsoleEvent,
  ContextOptionsEvent,
  HarSnapshot,
  ScreencastFrameEvent,
  StdioEvent
} from './trace-reader-types.js'
import {
  actionLabel,
  buildConsoleLogs,
  buildMetadata,
  harToNetworkRequest,
  nearestFrame,
  paramsToArgs,
  parseNdjson
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

function buildFrames(
  files: Record<string, Uint8Array>,
  frameEvents: ScreencastFrameEvent[],
  wallTime: number
): { frames: TracePlayerFrame[]; maxOffset: number } {
  const frames: TracePlayerFrame[] = []
  let maxOffset = 0
  for (const event of frameEvents) {
    const data = files[`resources/${event.sha1}`]
    if (!data) {
      continue
    }
    frames.push({
      timestamp: wallTime + event.timestamp,
      screenshot: Buffer.from(data).toString('base64')
    })
    maxOffset = Math.max(maxOffset, event.timestamp)
  }
  frames.sort((a, b) => a.timestamp - b.timestamp)
  return { frames, maxOffset }
}

function buildCommands(
  events: CategorizedEvents,
  frames: TracePlayerFrame[],
  wallTime: number
): { commands: CommandLog[]; maxOffset: number } {
  const commands: CommandLog[] = []
  let maxOffset = 0
  for (const [callId, before] of events.befores) {
    // Group markers are structure, not actions — as command rows their end
    // timestamp ties with the last action and steals the active highlight.
    if (before.class === 'Tracing') {
      continue
    }
    const after = events.afters.get(callId)
    const endOffset = after?.endTime ?? before.startTime
    maxOffset = Math.max(maxOffset, endOffset)
    const command: CommandLog = {
      command:
        REVERSE_ACTION_MAP[`${before.class}.${before.method}`] ?? before.method,
      args: paramsToArgs(before.params),
      // Show the trace-style label (`Element.fill("x")`); the command
      // name above still drives the UI's category colour and icon.
      title: actionLabel(before.class, before.method, before.params),
      startTime: wallTime + before.startTime,
      timestamp: wallTime + endOffset
    }
    if (after?.error) {
      command.error = { name: 'Error', message: after.error.message }
    }
    const frame = nearestFrame(frames, command.timestamp)
    if (frame) {
      command.screenshot = frame.screenshot
    }
    commands.push(command)
  }
  commands.sort((a, b) => a.timestamp - b.timestamp)
  return { commands, maxOffset }
}

/** Parse an in-memory trace.zip buffer into a player payload. Pure (no I/O). */
export function parseTraceZip(zip: Uint8Array): TracePlayerData {
  const files = unzipSync(zip)
  const readEntry = (name: string) =>
    files[name] ? strFromU8(files[name]) : ''
  const categorized = categorizeEvents(parseNdjson(readEntry('trace.trace')))
  const wallTime = categorized.ctx?.wallTime ?? 0
  const { frames, maxOffset: frameMax } = buildFrames(
    files,
    categorized.frameEvents,
    wallTime
  )
  const { commands, maxOffset: cmdMax } = buildCommands(
    categorized,
    frames,
    wallTime
  )
  const networkRequests = parseNdjson(readEntry('trace.network')).map(
    (entry, index) =>
      harToNetworkRequest((entry as { snapshot: HarSnapshot }).snapshot, index)
  )
  const trace: TraceLog = {
    mutations: [],
    logs: [],
    consoleLogs: buildConsoleLogs(categorized.consoleEvents, wallTime),
    networkRequests,
    metadata: buildMetadata(categorized.ctx),
    commands,
    sources: {},
    suites: []
  }
  return {
    trace,
    frames,
    startTime: wallTime,
    duration: Math.max(frameMax, cmdMax)
  }
}

/** Read a trace.zip from disk and reconstruct the player payload. */
export async function readTraceZip(zipPath: string): Promise<TracePlayerData> {
  const buffer = await fs.readFile(zipPath)
  return parseTraceZip(new Uint8Array(buffer))
}
