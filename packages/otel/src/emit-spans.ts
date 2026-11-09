import {
  ROOT_CONTEXT,
  SpanStatusCode,
  trace,
  type Context,
  type Span,
  type SpanOptions,
  type Tracer
} from '@opentelemetry/api'
import type {
  NetworkRequest,
  TraceActionChild,
  TracePlayerData
} from '@wdio/devtools-shared'
import * as attr from './attributes.js'
import type { ManifestTest } from './manifest.js'
import {
  actionStart,
  normalizeSelector,
  STATE_FAILED,
  type ActionInfo,
  type PreparedRoot,
  type PreparedTest
} from './prepared.js'
import {
  derivedSpanId,
  type PinnedIdGenerator,
  type PinnedSpanIds
} from './span-ids.js'

const REPORTED_CONSOLE_LEVELS: ReadonlySet<string> = new Set(['warn', 'error'])

export const MAX_EVENTS_PER_TEST = 100
export interface TelemetrySink {
  tracer: Tracer
  ids: PinnedIdGenerator
  flush: () => Promise<void>
}

/** The SDK takes ids from `ids` only for the span started inside this call. */
function startPinned(
  sink: TelemetrySink,
  ids: PinnedSpanIds | undefined,
  name: string,
  options: SpanOptions,
  context: Context
): Span {
  sink.ids.pin(ids)
  try {
    return sink.tracer.startSpan(name, options, context)
  } finally {
    sink.ids.pin(undefined)
  }
}

function startActionSpan(
  sink: TelemetrySink,
  info: ActionInfo,
  parent: Context,
  rootSpanId: string
): Span {
  const { command } = info
  const span = startPinned(
    sink,
    { spanId: derivedSpanId(rootSpanId, String(info.ordinal)) },
    command.title ?? command.command,
    {
      startTime: new Date(actionStart(command)),
      attributes: {
        [attr.ATTR_ACTION_KEY]: info.key,
        [attr.ATTR_ACTION_INDEX]: info.ordinal,
        [attr.ATTR_ACTION_METHOD]: command.command,
        ...(command.selector
          ? { [attr.ATTR_ACTION_SELECTOR]: normalizeSelector(command.selector) }
          : {})
      }
    },
    parent
  )
  if (info.failure) {
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: info.failure.message
    })
    span.recordException({ message: info.failure.message })
  }
  span.end(new Date(Math.max(command.timestamp, actionStart(command))))
  return span
}

function emitTree(
  sink: TelemetrySink,
  children: TraceActionChild[],
  actions: ActionInfo[],
  parent: Context,
  rootSpanId: string,
  groupPrefix = ''
): void {
  children.forEach((child, index) => {
    if ('group' in child) {
      const groupPath = `${groupPrefix}${index}`
      const span = startPinned(
        sink,
        { spanId: derivedSpanId(rootSpanId, `group:${groupPath}`) },
        child.group.title,
        { startTime: new Date(child.group.startTime) },
        parent
      )
      emitTree(
        sink,
        child.group.children,
        actions,
        trace.setSpan(parent, span),
        rootSpanId,
        `${groupPath}.`
      )
      span.end(new Date(child.group.endTime))
    } else {
      const span = startActionSpan(
        sink,
        actions[child.commandIndex],
        parent,
        rootSpanId
      )
      emitTree(
        sink,
        child.children ?? [],
        actions,
        trace.setSpan(parent, span),
        rootSpanId,
        `c${child.commandIndex}:`
      )
    }
  })
}

function addTestEvents(span: Span, data: TracePlayerData): void {
  data.trace.consoleLogs
    .filter((log) => REPORTED_CONSOLE_LEVELS.has(log.type))
    .slice(0, MAX_EVENTS_PER_TEST)
    .forEach((log) =>
      span.addEvent(
        attr.EVENT_CONSOLE,
        {
          [attr.ATTR_CONSOLE_TYPE]: log.type,
          [attr.ATTR_CONSOLE_MESSAGE]: log.args.map(stringifyArg).join(' ')
        },
        new Date(log.timestamp)
      )
    )
  data.trace.networkRequests
    .filter(isFailedRequest)
    .slice(0, MAX_EVENTS_PER_TEST)
    .forEach((request) =>
      span.addEvent(
        attr.EVENT_REQUEST_FAILED,
        {
          [attr.ATTR_URL_PATH]: urlPath(request.url),
          [attr.ATTR_HTTP_METHOD]: request.method,
          [attr.ATTR_NETWORK_STATUS]: request.status ?? -1
        },
        new Date(request.startTime)
      )
    )
}

function emitRoot(
  sink: TelemetrySink,
  test: ManifestTest,
  root: PreparedRoot
): void {
  const span = startPinned(
    sink,
    root.ids,
    test.title,
    {
      startTime: new Date(root.bounds.startMs),
      attributes: root.attributes
    },
    root.context
  )
  if (root.state === STATE_FAILED) {
    span.setStatus({ code: SpanStatusCode.ERROR, message: root.errorMessage })
  }
  if (root.trace) {
    const children =
      root.trace.data.groups ??
      root.trace.actions.map((_, commandIndex) => ({ commandIndex }))
    emitTree(
      sink,
      children,
      root.trace.actions,
      trace.setSpan(ROOT_CONTEXT, span),
      span.spanContext().spanId
    )
    addTestEvents(span, root.trace.data)
  }
  span.end(new Date(root.bounds.endMs))
}

export function emitPrepared(sink: TelemetrySink, item: PreparedTest): void {
  for (const root of item.roots) {
    emitRoot(sink, item.test, root)
  }
}

function stringifyArg(arg: unknown): string {
  return typeof arg === 'string' ? arg : (JSON.stringify(arg) ?? String(arg))
}

function urlPath(url: string): string {
  try {
    return new URL(url).pathname
  } catch {
    return url.split(/[?#]/, 1)[0]
  }
}

function isFailedRequest(request: NetworkRequest): boolean {
  return (
    request.status !== undefined &&
    (request.status === 0 || request.status >= 400)
  )
}
