import path from 'node:path'
import {
  ROOT_CONTEXT,
  createTraceState,
  trace,
  type Context
} from '@opentelemetry/api'
import {
  effectiveFailure,
  retriedRows,
  type CommandLog,
  type TraceActionChild,
  type TracePlayerData
} from '@wdio/devtools-shared'
import * as attr from './attributes.js'
import {
  artifactUrlFor,
  describe,
  traceArtifactsByUid,
  zipReader
} from './artifact-sources.js'
import { emitPrepared, type TelemetrySink } from './emit-spans.js'
import type { Manifest, ManifestTest } from './manifest.js'
import {
  actionStart,
  normalizeSelector,
  STATE_FAILED,
  STATE_PASSED,
  type ActionInfo,
  type AttemptView,
  type Bounds,
  type PreparedRoot,
  type PreparedTest,
  type TraceEvidence
} from './prepared.js'

type ManifestParent = NonNullable<Manifest['parent']>

export interface ManifestInput {
  file: string
  manifest: Manifest
  mtimeMs: number
}

export interface PushInput {
  manifests: ManifestInput[]
  runId: string
  artifactBaseUrl?: string
  traceZips: boolean
  loadZip: (zipPath: string) => Uint8Array
  warn: (message: string) => void
}

export interface PushPlan {
  /** Zips requested under --trace-zips that could not be read or parsed; complete once `emit` has run. */
  unreadable: () => string[]
  emit: (sink: TelemetrySink) => Promise<number>
}

interface RunContext {
  runId: string
  mtimeMs: number
  parent: ManifestParent | undefined
  warn: (message: string) => void
}

interface TestSource {
  data: TracePlayerData | undefined
  artifactUrl: string | undefined
}

interface PreparedFacts {
  test: ManifestTest
  run: RunContext
  span: Bounds | undefined
  evidence: TraceEvidence | undefined
  finalExtra: Record<string, string | number>
  errorMessage: string | undefined
}

function actionKey(command: CommandLog): string {
  return command.selector
    ? `${command.command} ${normalizeSelector(command.selector)}`
    : command.command
}

function actionInfos(commands: CommandLog[]): ActionInfo[] {
  const chronological = commands
    .map((command, index) => ({ command, index }))
    .sort(
      (a, b) =>
        actionStart(a.command) - actionStart(b.command) || a.index - b.index
    )
  const retried = retriedRows(commands)
  const infos = new Array<ActionInfo>(commands.length)
  chronological.forEach(({ command, index }, ordinal) => {
    infos[index] = {
      command,
      key: actionKey(command),
      ordinal,
      failure: cappedFailure(effectiveFailure(command, retried))
    }
  })
  return infos
}

const MAX_ERROR_MESSAGE_LENGTH = 4096

function capLength(message: string): string {
  return message.length > MAX_ERROR_MESSAGE_LENGTH
    ? `${message.slice(0, MAX_ERROR_MESSAGE_LENGTH)}…`
    : message
}

function cappedFailure(
  failure: { message: string } | undefined
): { message: string } | undefined {
  return failure && { message: capLength(failure.message) }
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

function testAttributes(
  test: ManifestTest,
  runId: string,
  state: string | undefined,
  attempt: number,
  extra: Record<string, string | number>
): Record<string, string | number> {
  return {
    [attr.ATTR_TEST_CASE_NAME]: test.title,
    [attr.ATTR_TEST_SUITE_NAME]: test.specFile,
    ...(state !== undefined
      ? { [attr.ATTR_TEST_CASE_RESULT_STATUS]: status(state) }
      : {}),
    [attr.ATTR_TEST_ATTEMPT]: attempt,
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

function union(a: Bounds, b: Bounds): Bounds {
  return {
    startMs: Math.min(a.startMs, b.startMs),
    endMs: Math.max(a.endMs, b.endMs)
  }
}

/** The test's own timing, for a manifest that predates `attempts`. */
function testBounds(test: ManifestTest): Bounds | undefined {
  const endMs =
    test.endTime ??
    (test.startTime !== undefined && test.durationMs !== undefined
      ? test.startTime + test.durationMs
      : undefined)
  if (endMs === undefined) {
    return undefined
  }
  return {
    startMs:
      test.startTime ??
      (test.durationMs !== undefined ? endMs - test.durationMs : endMs),
    endMs
  }
}

/** A root covers its own timing and every action under it, so children never fall outside. */
function rootBounds(
  timing: Bounds | undefined,
  span: Bounds | undefined,
  fallbackMs: number
): Bounds {
  const base = timing ?? span ?? { startMs: fallbackMs, endMs: fallbackMs }
  return timing && span ? union(timing, span) : base
}

// The test's own timing describes its final attempt only, so an earlier attempt reads its record alone.
function timingAttributes(
  test: ManifestTest,
  view: AttemptView,
  span: Bounds | undefined
): Record<string, string | number> {
  const manifestMs = view.final
    ? (test.durationMs ??
      (test.startTime !== undefined && test.endTime !== undefined
        ? test.endTime - test.startTime
        : undefined) ??
      view.durationMs)
    : view.durationMs
  const durationMs =
    manifestMs ?? (view.final && span ? span.endMs - span.startMs : undefined)
  // Names where the duration came from: a manifest start with no end takes its end from the trace when there is one.
  const timeSource =
    manifestMs !== undefined
      ? attr.TIME_SOURCE_MANIFEST
      : view.final && span
        ? attr.TIME_SOURCE_TRACE
        : view.timing
          ? attr.TIME_SOURCE_MANIFEST
          : attr.TIME_SOURCE_MANIFEST_FILE
  return {
    ...(durationMs !== undefined
      ? { [attr.ATTR_DURATION_MS]: durationMs }
      : {}),
    [attr.ATTR_TIME_SOURCE]: timeSource
  }
}

function attemptViews(test: ManifestTest): AttemptView[] {
  if (!test.attempts?.length) {
    return [
      {
        attempt: test.attempt,
        state: test.state,
        ids: undefined,
        timing: testBounds(test),
        durationMs: undefined,
        final: true
      }
    ]
  }
  const records = [...test.attempts].sort((a, b) => a.attempt - b.attempt)
  return records.map((record) => {
    const final = record.final === true
    return {
      attempt: record.attempt,
      state: final ? test.state : record.state,
      ids: { traceId: record.traceId, spanId: record.spanId },
      timing: {
        startMs: record.startTime,
        endMs: record.endTime ?? record.startTime
      },
      durationMs:
        record.endTime === undefined
          ? undefined
          : record.endTime - record.startTime,
      final
    }
  })
}

// The writer mints every attempt's trace id from the same parent it records, so the two always agree.
function parentContextOf(parent: ManifestParent | undefined): Context {
  if (!parent) {
    return ROOT_CONTEXT
  }
  return trace.setSpanContext(ROOT_CONTEXT, {
    traceId: parent.traceId,
    spanId: parent.spanId,
    traceFlags: parent.traceFlags,
    isRemote: true,
    ...(parent.traceState !== undefined
      ? { traceState: createTraceState(parent.traceState) }
      : {})
  })
}

// A superseded final loses only the final flag: its error, failed action and zip are still its own, not a retry's.
function prepareRoot(
  view: AttemptView,
  facts: PreparedFacts,
  superseded: boolean
): PreparedRoot {
  const { test, run, span, evidence, finalExtra, errorMessage } = facts
  const final = view.final && !superseded
  const attributes = testAttributes(test, run.runId, view.state, view.attempt, {
    ...timingAttributes(test, view, span),
    ...(view.final ? finalExtra : {})
  })
  return {
    attributes: { ...attributes, [attr.ATTR_TEST_FINAL_ATTEMPT]: final },
    bounds: rootBounds(view.timing, view.final ? span : undefined, run.mtimeMs),
    state: view.state,
    errorMessage: view.final ? errorMessage : undefined,
    ids: view.ids,
    context: parentContextOf(run.parent),
    final,
    trace: view.final ? evidence : undefined
  }
}

/** A passing test's erroring command is one it caught or retried, not its failure. */
function failedActionOf(
  test: ManifestTest,
  actions: ActionInfo[]
): ActionInfo | undefined {
  if (test.state !== STATE_FAILED) {
    return undefined
  }
  return actions
    .filter((action) => action.failure)
    .sort((a, b) => a.ordinal - b.ordinal)[0]
}

function prepareTest(
  test: ManifestTest,
  source: TestSource,
  run: RunContext,
  superseded: boolean
): PreparedTest {
  const { data, artifactUrl } = source
  const actions = data ? actionInfos(data.trace.commands) : []
  const failure = failedActionOf(test, actions)
  const evidence: TraceEvidence | undefined = data
    ? {
        data,
        actions,
        failure,
        span: bounds(actions, data.groups ?? [], data.startTime)
      }
    : undefined
  const span = evidence?.span
  const errorMessage =
    test.error === undefined ? failure?.failure?.message : capLength(test.error)
  const finalExtra = {
    ...(errorMessage !== undefined
      ? { [attr.ATTR_ERROR_MESSAGE]: errorMessage }
      : {}),
    ...(failure ? { [attr.ATTR_FAILED_ACTION]: failure.key } : {}),
    ...(artifactUrl ? { [attr.ATTR_ARTIFACT_URL]: artifactUrl } : {})
  }
  return {
    test,
    roots: attemptViews(test).map((view) =>
      prepareRoot(
        view,
        { test, run, span, evidence, finalExtra, errorMessage },
        superseded
      )
    )
  }
}

/** Each test's preparation is deferred so its zip is parsed only when its spans are emitted. */
function planManifest(
  input: PushInput,
  { file, manifest, mtimeMs }: ManifestInput,
  readTrace: (zipPath: string) => TracePlayerData | undefined,
  isSuperseded: (test: ManifestTest) => boolean
): Array<() => PreparedTest> {
  const dir = path.dirname(file)
  const testUids = new Set(manifest.tests.map((test) => test.uid))
  const artifactsByUid = traceArtifactsByUid(manifest)
  const run: RunContext = {
    runId: input.runId,
    mtimeMs,
    parent: manifest.parent,
    warn: input.warn
  }
  const pending: Array<() => PreparedTest> = []
  let warnedSharedZip = false
  for (const test of manifest.tests) {
    const artifact = artifactsByUid.get(test.uid)
    const sharedZip =
      artifact !== undefined &&
      artifact.testUids.filter((uid) => testUids.has(uid)).length > 1
    if (sharedZip && input.traceZips && !warnedSharedZip) {
      input.warn(
        `skipped action spans in ${file}: its zips cover several tests, so they are linked but not read; record with traceGranularity:'test' for per-test action spans`
      )
      warnedSharedZip = true
    }
    // A dropped zip (retained:false) has no file to link to; a shared one still replays the test among others.
    const zipPath = artifact?.retained
      ? path.resolve(dir, artifact.path)
      : undefined
    const artifactUrl =
      zipPath && input.artifactBaseUrl
        ? artifactUrlFor(dir, zipPath, input.artifactBaseUrl, input.warn)
        : undefined
    pending.push(() =>
      prepareTest(
        test,
        {
          data:
            input.traceZips && zipPath && !sharedZip
              ? readTrace(zipPath)
              : undefined,
          artifactUrl
        },
        run,
        isSuperseded(test)
      )
    )
  }
  return pending
}

interface FinalOutcome {
  test: ManifestTest
  state: string
  startMs: number
  endMs: number
}

function finalOutcomeOf(test: ManifestTest, mtimeMs: number): FinalOutcome {
  const record = test.attempts?.find((candidate) => candidate.final)
  const startMs = record?.startTime ?? test.startTime ?? mtimeMs
  return {
    test,
    state: test.state,
    startMs,
    endMs: record?.endTime ?? test.endTime ?? startMs
  }
}

// specFileRetries reruns a failed spec in a fresh worker whose manifest marks its own final, so a failed final that
// another worker's final started after is a retried attempt. Overlapping finals are siblings (another browser, shard
// or worker) and each keeps its own outcome.
function supersededFinals(
  manifests: readonly ManifestInput[]
): (test: ManifestTest) => boolean {
  const byUid = new Map<string, FinalOutcome[]>()
  for (const { manifest, mtimeMs } of manifests) {
    for (const test of manifest.tests) {
      const finals = byUid.get(test.uid) ?? []
      finals.push(finalOutcomeOf(test, mtimeMs))
      byUid.set(test.uid, finals)
    }
  }
  const superseded = new Set<ManifestTest>()
  for (const finals of byUid.values()) {
    for (const earlier of finals) {
      if (
        earlier.state === STATE_FAILED &&
        finals.some(
          (later) => later !== earlier && later.startMs >= earlier.endMs
        )
      ) {
        superseded.add(earlier.test)
      }
    }
  }
  return (test) => superseded.has(test)
}

export function planPush(input: PushInput): PushPlan {
  const reader = zipReader(input.loadZip, input.warn)
  const isSuperseded = supersededFinals(input.manifests)
  const pending = input.manifests.flatMap((manifest) =>
    planManifest(input, manifest, reader.read, isSuperseded)
  )
  return {
    unreadable: () => reader.unreadable(),
    async emit(sink) {
      for (const prepare of pending) {
        emitPrepared(sink, prepare())
      }
      try {
        await sink.flush()
      } catch (error) {
        throw new Error(
          `the export of ${pending.length} test(s) failed, so some may not have reached the collector: ${describe(error)}`
        )
      }
      return pending.length
    }
  }
}
