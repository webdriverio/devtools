// Converts a captured TraceLog into a Playwright v8 trace.zip Buffer.
// Stays runner-agnostic so the three adapters can call this directly.

import type {
  ActionSnapshot,
  CommandLog,
  NetworkRequest,
  TraceLog
} from '@wdio/devtools-shared'
import { formatActionTitle, mapCommandToAction } from './action-mapping.js'
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

type TraceEvent = ContextOptionsEvent | BeforeEvent | AfterEvent

function shortId(sessionId?: string): string {
  return (sessionId ?? Math.random().toString(36).slice(2, 10)).slice(0, 8)
}

function buildContextOptions(
  trace: TraceLog,
  contextId: string,
  wallTime: number
): ContextOptionsEvent {
  const caps = trace.metadata.capabilities as
    | Record<string, unknown>
    | undefined
  const browserName = (caps?.browserName as string) ?? 'chromium'
  const viewport = trace.metadata.viewport ?? { width: 1280, height: 720 }
  return {
    version: TRACE_VERSION,
    type: 'context-options',
    origin: 'library',
    libraryName: LIBRARY_NAME,
    libraryVersion: LIBRARY_VERSION,
    browserName,
    platform: process.platform,
    wallTime,
    monotonicTime: 0,
    sdkLanguage: 'javascript',
    title: browserName,
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
  let callCounter = 0
  for (const cmd of commands) {
    const action = mapCommandToAction(cmd.command)
    if (!action) {
      continue
    }
    callCounter++
    const callId = `call@${callCounter}`
    const relativeMs = Math.max(0, cmd.timestamp - wallTime)
    const params: Record<string, unknown> = Object.fromEntries(
      cmd.args.map((a, i) => [String(i), a])
    )
    events.push({
      type: 'before',
      callId,
      startTime: relativeMs,
      class: action.class,
      method: action.method,
      pageId,
      params,
      title: formatActionTitle(action, cmd.args, params)
    })
    const afterEvent: AfterEvent = {
      type: 'after',
      callId,
      endTime: relativeMs
    }
    if (cmd.error) {
      const err = cmd.error as { message?: string }
      afterEvent.error = { message: err.message ?? String(cmd.error) }
    }
    events.push(afterEvent)
  }
  return events
}

function buildNetworkNdjson(requests: NetworkRequest[]): Buffer {
  if (!requests.length) {
    return Buffer.alloc(0)
  }
  const lines = requests.map((r) => JSON.stringify(networkRequestToHar(r)))
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
        resourceName: `elements-${base}.json`,
        data: Buffer.from(JSON.stringify(snap.elements), 'utf8')
      })
    }
    if (snap.snapshotText) {
      out.push({
        resourceName: `snapshot-${base}.txt`,
        data: Buffer.from(snap.snapshotText, 'utf8')
      })
    }
  }
  return out
}

/**
 * Build a Playwright v8 trace.zip buffer from the captured TraceLog.
 * Filters commands through ACTION_MAP and renames to Playwright vocabulary;
 * network entries become HAR resource-snapshots; per-action screenshots,
 * element JSON, and snapshot text are written under `resources/`.
 */
export async function exportTraceZip(
  trace: TraceLog,
  opts: { sessionId?: string; wallTimeOverride?: number } = {}
): Promise<Buffer> {
  const wallTime = opts.wallTimeOverride ?? Date.now()
  const idPrefix = shortId(opts.sessionId)
  const contextId = `context@${idPrefix}`
  const pageId = `page@${idPrefix}`
  const events: TraceEvent[] = [
    buildContextOptions(trace, contextId, wallTime),
    ...buildActionEvents(trace.commands, pageId, wallTime)
  ]
  const traceNdjson = events.map((e) => JSON.stringify(e)).join('\n')
  const networkNdjson = buildNetworkNdjson(trace.networkRequests)
  const resources = buildSnapshotResources(trace.actionSnapshots ?? [], pageId)
  return buildTraceZip({ traceNdjson, networkNdjson, resources })
}
