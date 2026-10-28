import path from 'node:path'
import {
  ROOT_CONTEXT,
  SpanStatusCode,
  trace,
  type Context,
  type Span,
  type Tracer
} from '@opentelemetry/api'
import { SeverityNumber, type Logger } from '@opentelemetry/api-logs'
import { parseTraceZip } from '@wdio/devtools-trace'
import type {
  CommandLog,
  NetworkRequest,
  TraceActionChild,
  TracePlayerData
} from '@wdio/devtools-shared'
import * as attr from './attributes.js'
import type { Manifest, ManifestArtifact, ManifestTest } from './manifest.js'

const MAX_EVENTS_PER_TEST = 100
const REPORTED_CONSOLE_LEVELS: ReadonlySet<string> = new Set(['warn', 'error'])
const STATE_PASSED = 'passed'
const STATE_FAILED = 'failed'
const LOKI_LATE_RECORD_WINDOW_MS = 60 * 60 * 1000
const RETRY_DIR_SUFFIX = /-retry(\d+)$/

export interface ManifestInput {
  file: string
  manifest: Manifest
  mtimeMs: number
}

export interface PushInput {
  manifests: ManifestInput[]
  runId: string
  nowMs: number
  artifactBaseUrl?: string
  loadZip: (zipPath: string) => Uint8Array
  warn: (message: string) => void
}

export interface TelemetrySink {
  tracer: Tracer
  logger: Logger
  flush: () => Promise<void>
}

export interface PushPlan {
  problems: string[]
  emit: (sink: TelemetrySink) => Promise<number>
}

interface ActionInfo {
  command: CommandLog
  key: string
  ordinal: number
}

interface Bounds {
  startMs: number
  endMs: number
}

interface TraceEvidence {
  data: TracePlayerData
  actions: ActionInfo[]
  failure: ActionInfo | undefined
  span: Bounds
}

interface PreparedTest {
  test: ManifestTest
  timeMs: number
  attributes: Record<string, string | number>
  errorMessage: string | undefined
  trace: TraceEvidence | undefined
}

function normalizeSelector(selector: string): string {
  return selector.trim().replace(/\s+/g, ' ')
}

function actionKey(command: CommandLog): string {
  return command.selector
    ? `${command.command} ${normalizeSelector(command.selector)}`
    : command.command
}

function actionStart(command: CommandLog): number {
  return command.startTime ?? command.timestamp
}

function actionInfos(commands: CommandLog[]): ActionInfo[] {
  const chronological = commands
    .map((command, index) => ({ command, index }))
    .sort(
      (a, b) =>
        actionStart(a.command) - actionStart(b.command) || a.index - b.index
    )
  const infos = new Array<ActionInfo>(commands.length)
  chronological.forEach(({ command, index }, ordinal) => {
    infos[index] = { command, key: actionKey(command), ordinal }
  })
  return infos
}

function status(state: string): string {
  if (state === STATE_PASSED) {
    return attr.TEST_CASE_RESULT_STATUS_PASS
  }
  if (state === STATE_FAILED) {
    return attr.TEST_CASE_RESULT_STATUS_FAIL
  }
  return state
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

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function startActionSpan(
  tracer: Tracer,
  info: ActionInfo,
  parent: Context
): Span {
  const { command } = info
  const span = tracer.startSpan(
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
  if (command.error) {
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: command.error.message
    })
    span.recordException({ message: command.error.message })
  }
  span.end(new Date(Math.max(command.timestamp, actionStart(command))))
  return span
}

function emitTree(
  tracer: Tracer,
  children: TraceActionChild[],
  actions: ActionInfo[],
  parent: Context
): void {
  for (const child of children) {
    if ('group' in child) {
      const span = tracer.startSpan(
        child.group.title,
        { startTime: new Date(child.group.startTime) },
        parent
      )
      emitTree(
        tracer,
        child.group.children,
        actions,
        trace.setSpan(parent, span)
      )
      span.end(new Date(child.group.endTime))
    } else {
      startActionSpan(tracer, actions[child.commandIndex], parent)
    }
  }
}

function addTestEvents(span: Span, data: TracePlayerData): void {
  data.trace.consoleLogs
    .filter((log) => REPORTED_CONSOLE_LEVELS.has(log.type))
    .slice(0, MAX_EVENTS_PER_TEST)
    .forEach((log) =>
      span.addEvent(
        attr.EVENT_CONSOLE,
        {
          [attr.ATTR_MESSAGE_TYPE]: log.type,
          [attr.ATTR_MESSAGE]: log.args.map(stringifyArg).join(' ')
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

function testAttributes(
  test: ManifestTest,
  runId: string,
  extra: Record<string, string | number>
): Record<string, string | number> {
  return {
    [attr.ATTR_TEST_CASE_NAME]: test.title,
    [attr.ATTR_TEST_SUITE_NAME]: test.specFile,
    [attr.ATTR_TEST_CASE_RESULT_STATUS]: status(test.state),
    [attr.ATTR_TEST_ATTEMPT]: test.attempt,
    [attr.ATTR_RUN_ID]: runId,
    ...extra
  }
}

function actionBounds(action: ActionInfo): Bounds {
  return {
    startMs: actionStart(action.command),
    endMs: Math.max(action.command.timestamp, actionStart(action.command))
  }
}

function groupBounds(children: TraceActionChild[]): Bounds[] {
  return children.flatMap((child) =>
    'group' in child
      ? [
          { startMs: child.group.startTime, endMs: child.group.endTime },
          ...groupBounds(child.group.children)
        ]
      : []
  )
}

function bounds(
  actions: ActionInfo[],
  groups: TraceActionChild[],
  fallbackMs: number
): Bounds {
  const spans = [...actions.map(actionBounds), ...groupBounds(groups)]
  if (!spans.length) {
    return { startMs: fallbackMs, endMs: fallbackMs }
  }
  return {
    startMs: Math.min(...spans.map((span) => span.startMs)),
    endMs: Math.max(...spans.map((span) => span.endMs))
  }
}

function timingOf(
  test: ManifestTest,
  span: Bounds | undefined,
  mtimeMs: number
): { timeMs: number; source: string } {
  if (test.endTime !== undefined) {
    return { timeMs: test.endTime, source: attr.TIME_SOURCE_MANIFEST }
  }
  if (span) {
    return { timeMs: span.startMs, source: attr.TIME_SOURCE_TRACE }
  }
  return { timeMs: mtimeMs, source: attr.TIME_SOURCE_MANIFEST_FILE }
}

function prepareTest(
  test: ManifestTest,
  runId: string,
  data: TracePlayerData | undefined,
  artifactUrl: string | undefined,
  mtimeMs: number
): PreparedTest {
  const actions = data ? actionInfos(data.trace.commands) : []
  // A passing test's erroring command is one it caught or retried, not its failure.
  const failure =
    test.state === STATE_FAILED
      ? actions
          .filter((action) => action.command.error)
          .sort((a, b) => a.ordinal - b.ordinal)[0]
      : undefined
  const span = data
    ? bounds(actions, data.groups ?? [], data.startTime)
    : undefined
  const errorMessage = test.error ?? failure?.command.error?.message
  const manifestDurationMs =
    test.startTime !== undefined && test.endTime !== undefined
      ? test.endTime - test.startTime
      : undefined
  const durationMs =
    test.durationMs ??
    manifestDurationMs ??
    (span ? span.endMs - span.startMs : undefined)
  const timing = timingOf(test, span, mtimeMs)
  const attributes = testAttributes(test, runId, {
    ...(durationMs !== undefined
      ? { [attr.ATTR_DURATION_MS]: durationMs }
      : {}),
    [attr.ATTR_TIME_SOURCE]: timing.source,
    ...(errorMessage !== undefined
      ? { [attr.ATTR_ERROR_MESSAGE]: errorMessage }
      : {}),
    ...(failure ? { [attr.ATTR_FAILED_ACTION]: failure.key } : {}),
    ...(artifactUrl ? { [attr.ATTR_ARTIFACT_URL]: artifactUrl } : {})
  })
  return {
    test,
    timeMs: timing.timeMs,
    attributes,
    errorMessage,
    trace: data && span ? { data, actions, failure, span } : undefined
  }
}

function emitRoot(tracer: Tracer, item: PreparedTest): Span {
  const { test, attributes, errorMessage, trace: evidence } = item
  if (!evidence) {
    throw new Error(`no trace evidence for ${test.uid}`)
  }
  const root = tracer.startSpan(
    test.title,
    { startTime: new Date(evidence.span.startMs), attributes },
    ROOT_CONTEXT
  )
  if (test.state === STATE_FAILED) {
    root.setStatus({ code: SpanStatusCode.ERROR, message: errorMessage })
  }
  const children =
    evidence.data.groups ??
    evidence.actions.map((_, commandIndex) => ({ commandIndex }))
  emitTree(
    tracer,
    children,
    evidence.actions,
    trace.setSpan(ROOT_CONTEXT, root)
  )
  addTestEvents(root, evidence.data)
  root.end(new Date(evidence.span.endMs))
  return root
}

function emitPrepared(sink: TelemetrySink, item: PreparedTest): void {
  const { test, timeMs, attributes } = item
  const root = item.trace ? emitRoot(sink.tracer, item) : undefined
  const failed = test.state === STATE_FAILED
  sink.logger.emit({
    body: test.title,
    severityNumber: failed ? SeverityNumber.ERROR : SeverityNumber.INFO,
    severityText: failed ? 'ERROR' : 'INFO',
    attributes,
    timestamp: new Date(timeMs),
    ...(root ? { context: trace.setSpan(ROOT_CONTEXT, root) } : {})
  })
}

function warnIfOutsideLokiWindow(
  ordered: PreparedTest[],
  nowMs: number,
  warn: (message: string) => void
): void {
  if (ordered.length === 0) {
    return
  }
  const oldest = ordered[0].timeMs
  const newest = ordered[ordered.length - 1].timeMs
  if (
    newest - oldest <= LOKI_LATE_RECORD_WINDOW_MS &&
    nowMs - oldest <= LOKI_LATE_RECORD_WINDOW_MS
  ) {
    return
  }
  warn(
    `${ordered.length} record(s) span ${new Date(oldest).toISOString()} to ${new Date(newest).toISOString()}, and the oldest is ${Math.round((nowMs - oldest) / 60000)} min behind now. Loki silently drops entries about an hour behind the newest in a stream (HTTP 200, no error), so those records may be missing. Push promptly after the run. See packages/otel/README.md`
  )
}

function attemptKeyOf(test: ManifestTest): string {
  return test.attempt > 0 ? `${test.uid}-retry${test.attempt}` : test.uid
}

function retryOf(artifact: ManifestArtifact): number {
  const dir = path.basename(path.dirname(artifact.path))
  return Number(RETRY_DIR_SUFFIX.exec(dir)?.[1] ?? 0)
}

/** The zip of the test's final attempt; an earlier attempt's zip never stands in for it. */
function traceArtifactFor(
  manifest: Manifest,
  test: ManifestTest
): ManifestArtifact | undefined {
  const candidates = manifest.artifacts.filter(
    (artifact) =>
      artifact.kind === 'trace' && artifact.testUids.includes(test.uid)
  )
  if (candidates.some((artifact) => artifact.key !== undefined)) {
    return candidates.find((artifact) => artifact.key === attemptKeyOf(test))
  }
  return candidates.reduce<ManifestArtifact | undefined>(
    (best, artifact) =>
      best === undefined || retryOf(artifact) > retryOf(best) ? artifact : best,
    undefined
  )
}

function withTrailingSlash(url: string): string {
  return url.endsWith('/') ? url : `${url}/`
}

function artifactUrlFor(
  dir: string,
  zipPath: string,
  base: string,
  warn: (message: string) => void
): string | undefined {
  const relative = path.relative(dir, zipPath)
  const segments = relative.split(path.sep)
  if (path.isAbsolute(relative) || segments.includes('..')) {
    warn(
      `no artifact URL for ${zipPath}: the zip is outside the manifest directory ${dir}, so it cannot be addressed under --artifact-base-url`
    )
    return undefined
  }
  return new URL(
    segments.map(encodeURIComponent).join('/'),
    withTrailingSlash(base)
  ).href
}

function zipReader(
  loadZip: (zipPath: string) => Uint8Array,
  problems: string[]
): (zipPath: string) => TracePlayerData | undefined {
  const zips = new Map<string, TracePlayerData | undefined>()
  return (zipPath) => {
    if (!zips.has(zipPath)) {
      try {
        zips.set(zipPath, parseTraceZip(loadZip(zipPath)))
      } catch (error) {
        problems.push(`${zipPath}: ${describe(error)}`)
        zips.set(zipPath, undefined)
      }
    }
    return zips.get(zipPath)
  }
}

/**
 * Reads every zip and builds every record before anything is exported, so a
 * missing or unparseable input is reported in full and nothing is pushed.
 */
export function planPush(input: PushInput): PushPlan {
  const problems: string[] = []
  const loadTrace = zipReader(input.loadZip, problems)
  const prepared: PreparedTest[] = []
  for (const { file, manifest, mtimeMs } of input.manifests) {
    const dir = path.dirname(file)
    const testUids = new Set(manifest.tests.map((test) => test.uid))
    let warnedSharedZip = false
    for (const test of manifest.tests) {
      const artifact = traceArtifactFor(manifest, test)
      const sharedZip =
        artifact !== undefined &&
        artifact.testUids.filter((uid) => testUids.has(uid)).length > 1
      if (sharedZip && !warnedSharedZip) {
        input.warn(
          `skipped traces in ${file}: traceGranularity:'test' is required for traces, so its zips cover several tests`
        )
        warnedSharedZip = true
      }
      const traced = sharedZip ? undefined : artifact
      const zipPath = traced ? path.resolve(dir, traced.path) : undefined
      const data = zipPath ? loadTrace(zipPath) : undefined
      const artifactUrl =
        zipPath && input.artifactBaseUrl
          ? artifactUrlFor(dir, zipPath, input.artifactBaseUrl, input.warn)
          : undefined
      prepared.push(prepareTest(test, input.runId, data, artifactUrl, mtimeMs))
    }
  }
  return {
    problems,
    async emit(sink) {
      const ordered = [...prepared].sort((a, b) => a.timeMs - b.timeMs)
      warnIfOutsideLokiWindow(ordered, input.nowMs, input.warn)
      let pushed = 0
      for (const item of ordered) {
        emitPrepared(sink, item)
        try {
          await sink.flush()
        } catch (error) {
          throw new Error(
            `${pushed} of ${ordered.length} test(s) were pushed before the export failed: ${describe(error)}`
          )
        }
        pushed++
      }
      return pushed
    }
  }
}
