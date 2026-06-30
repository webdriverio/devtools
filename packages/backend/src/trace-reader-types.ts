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

export interface ContextOptionsEvent {
  type: 'context-options'
  wallTime: number
  browserName?: string
  contextId?: string
  options?: { viewport?: { width: number; height: number } }
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

/** Trace events grouped by kind for the reconstruction pipeline. */
export interface CategorizedEvents {
  ctx?: ContextOptionsEvent
  befores: Map<string, BeforeEvent>
  afters: Map<string, AfterEvent>
  frameEvents: ScreencastFrameEvent[]
}
