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
}

export interface ScreencastFrameEvent {
  type: 'screencast-frame'
  sha1: string
  timestamp: number
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
    content?: { size: number; mimeType: string }
  }
}

/** One stream's trace events grouped by kind for the reconstruction pipeline. */
export interface CategorizedEvents {
  ctx?: ContextOptionsEvent
  befores: Map<string, BeforeEvent>
  afters: Map<string, AfterEvent>
  frameEvents: ScreencastFrameEvent[]
  consoleEvents: (ConsoleEvent | StdioEvent)[]
}

/** All streams' events combined; a zip may carry one context per stream. */
export interface MergedEvents extends Omit<CategorizedEvents, 'ctx'> {
  ctxs: ContextOptionsEvent[]
}
