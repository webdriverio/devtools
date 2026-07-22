// Shapes of the NDJSON events inside a trace.zip's `trace.trace` and the HAR
// snapshot shape from `trace.network`. Mirrors what core/trace-exporter.ts
// writes; consumed by the reader to reconstruct a player payload.

export interface BeforeEvent {
  type: 'before'
  callId: string
  startTime: number
  class: string
  method: string
  params?: Record<string, unknown>
  stack?: { file: string; line?: number; column?: number }[]
  title?: string
  /** Foreign runner streams: the runner step a library call renders under. */
  stepId?: string
  /** Group/container step this event nests under. */
  parentId?: string
}

export interface AfterEvent {
  type: 'after'
  callId: string
  endTime: number
  error?: { message: string }
  /** Command return value, restored onto CommandLog.result. */
  result?: unknown
  /** Pointer hit point, restored onto CommandLog.point (A8 input marker). */
  point?: { x: number; y: number }
}

export interface ScreencastFrameEvent {
  type: 'screencast-frame'
  sha1: string
  timestamp: number
}

/** Per-action DOM snapshot event. Always emitted (independent of the sparse/
 *  dense filmstrip), so it's the reliable anchor for per-command data: `callId`
 *  maps to the command and `wallTime` (the original snapshot ts) names the
 *  `-snapshot.txt` / `-elements.json` resources. */
export interface FrameSnapshotEvent {
  type: 'frame-snapshot'
  snapshot: { callId: string; pageId: string; wallTime: number }
}

export interface ConsoleEvent {
  type: 'console'
  time: number
  messageType: string
  text: string
  args?: { preview: string; value: unknown }[]
}

export interface StdioEvent {
  type: 'stdout' | 'stderr'
  timestamp: number
  text?: string
  /** Extension field restoring the test-vs-terminal origin; absent in foreign zips. */
  source?: 'test' | 'terminal'
}

export interface ContextOptionsEvent {
  type: 'context-options'
  wallTime: number
  /** Monotonic clock reading taken at `wallTime`; anchors monotonic event times. */
  monotonicTime?: number
  browserName?: string
  contextId?: string
  options?: { viewport?: { width: number; height: number } }
}

/** Sidecar `.stacks` shape: file table + per-call [fileIndex, line, column, function] frames. */
export interface SidecarStacks {
  files: string[]
  stacks: [number, [number, number, number, string][]][]
}

export interface HarContent {
  size: number
  mimeType: string
  /** Inline body; absent when the body lives in a `resources/` entry. */
  text?: string
  /** HAR body encoding — `base64` marks binary inline text. */
  encoding?: string
  /** Body resource name under `resources/` — sha1 hex, in foreign zips suffixed with a mime extension. */
  _sha1?: string
}

export interface HarSnapshot {
  startedDateTime: string
  time: number
  request: {
    method: string
    url: string
    headers: { name: string; value: string }[]
  }
  response?: {
    status: number
    statusText: string
    headers?: { name: string; value: string }[]
    content?: HarContent
  }
}

/** One stream's trace events grouped by kind for the reconstruction pipeline. */
export interface CategorizedEvents {
  ctx?: ContextOptionsEvent
  befores: Map<string, BeforeEvent>
  afters: Map<string, AfterEvent>
  frameEvents: ScreencastFrameEvent[]
  frameSnapshots: FrameSnapshotEvent[]
  consoleEvents: (ConsoleEvent | StdioEvent)[]
}

/** All streams' events combined; a zip may carry one context per stream. */
export interface MergedEvents extends Omit<CategorizedEvents, 'ctx'> {
  ctxs: ContextOptionsEvent[]
}
