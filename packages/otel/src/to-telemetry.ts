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
  type TracePlayerData
} from '@wdio/devtools-shared'
import * as attr from './attributes.js'
import {
  artifactUrlFor,
  describe,
  holdsEarlierAttempts,
  traceArtifactsByUid,
  zipReader
} from './artifact-sources.js'
import { emitPrepared, type TelemetrySink } from './emit-spans.js'
import type { Manifest, ManifestTest } from './manifest.js'
import { bounds, rootBounds, testBounds } from './bounds.js'
import {
  actionStart,
  capLength,
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
import { runIdOf, unsampledParent } from './run-identity.js'
import { supersededFinals } from './superseded-finals.js'

type ManifestParent = NonNullable<Manifest['parent']>

export interface ManifestInput {
  file: string
  manifest: Manifest
  mtimeMs: number
}

export interface PushInput {
  manifests: ManifestInput[]
  /** `--run-id`: names every manifest's run in place of the manifest's own runId. */
  runId?: string
  artifactBaseUrl?: string
  traceZips: boolean
  ignoreParentSampling: boolean
  consoleMessages: boolean
  loadZip: (zipPath: string) => Uint8Array
  realpath: (target: string) => string
  warn: (message: string) => void
}

export interface PushPlan {
  /** Zips requested under --trace-zips that could not be read or parsed; complete once `emit` has run. */
  unreadable: () => string[]
  /** Distinct run ids of the manifests that will be pushed, in the order first seen. */
  runIds: string[]
  pushedManifests: number
  /** Manifests left out because they were recorded under an unsampled TRACEPARENT. */
  unsampledManifests: number
  emit: (sink: TelemetrySink) => Promise<number>
}

interface RunContext {
  runId: string
  mtimeMs: number
  parent: ManifestParent | undefined
  sessionId: string
  browserName: string | undefined
  browserVersion: string | undefined
  platformName: string | undefined
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
  failureMessage: string | undefined
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

function cappedFailure(
  failure: { message: string } | undefined
): { message: string } | undefined {
  return (
    failure && { message: capLength(failure.message, MAX_ERROR_MESSAGE_LENGTH) }
  )
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

function browserAttributes(run: RunContext): Record<string, string> {
  const fields: Record<string, string | undefined> = {
    [attr.ATTR_DEVTOOLS_BROWSER_NAME]: run.browserName,
    [attr.ATTR_DEVTOOLS_BROWSER_VERSION]: run.browserVersion,
    [attr.ATTR_DEVTOOLS_PLATFORM_NAME]: run.platformName
  }
  return Object.fromEntries(
    Object.entries(fields).filter(
      (entry): entry is [string, string] => entry[1] !== undefined
    )
  )
}

function testAttributes(
  test: ManifestTest,
  run: RunContext,
  state: string | undefined,
  attempt: number,
  extra: Record<string, string | number>
): Record<string, string | number> {
  return {
    [attr.ATTR_TEST_CASE_NAME]: test.title,
    [attr.ATTR_TEST_SUITE_NAME]: test.specFile,
    [attr.ATTR_SESSION_ID]: run.sessionId,
    [attr.ATTR_DEVTOOLS_TEST_UID]: test.uid,
    ...browserAttributes(run),
    ...(state !== undefined
      ? { [attr.ATTR_TEST_CASE_RESULT_STATUS]: status(state) }
      : {}),
    [attr.ATTR_TEST_ATTEMPT]: attempt,
    [attr.ATTR_RUN_ID]: run.runId,
    ...extra
  }
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
        final: true,
        error: undefined
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
      final,
      error: record.error
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

// The final attempt reports the test's error; an earlier attempt reports only the error its own record kept.
function errorMessageOf(
  view: AttemptView,
  facts: PreparedFacts
): string | undefined {
  const own =
    view.error === undefined
      ? undefined
      : capLength(view.error, MAX_ERROR_MESSAGE_LENGTH)
  if (!view.final) {
    return own
  }
  return facts.test.error === undefined
    ? (own ?? facts.failureMessage)
    : capLength(facts.test.error, MAX_ERROR_MESSAGE_LENGTH)
}

// A superseded final loses only the final flag: its error, failed action and zip are still its own, not a retry's.
function prepareRoot(
  view: AttemptView,
  facts: PreparedFacts,
  superseded: boolean
): PreparedRoot {
  const { test, run, span, evidence, finalExtra } = facts
  const final = view.final && !superseded
  const errorMessage = errorMessageOf(view, facts)
  const attributes = testAttributes(test, run, view.state, view.attempt, {
    ...timingAttributes(test, view, span),
    ...(errorMessage !== undefined
      ? { [attr.ATTR_ERROR_MESSAGE]: errorMessage }
      : {}),
    ...(view.final ? finalExtra : {})
  })
  return {
    attributes: { ...attributes, [attr.ATTR_TEST_FINAL_ATTEMPT]: final },
    bounds: rootBounds(view.timing, view.final ? span : undefined, run.mtimeMs),
    state: view.state,
    errorMessage,
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
  const finalExtra = {
    ...(failure ? { [attr.ATTR_FAILED_ACTION]: failure.key } : {}),
    ...(artifactUrl ? { [attr.ATTR_ARTIFACT_URL]: artifactUrl } : {})
  }
  return {
    test,
    roots: attemptViews(test).map((view) =>
      prepareRoot(
        view,
        {
          test,
          run,
          span,
          evidence,
          finalExtra,
          failureMessage: failure?.failure?.message
        },
        superseded
      )
    )
  }
}

function runContextOf(
  input: PushInput,
  runId: string,
  manifest: Manifest,
  mtimeMs: number
): RunContext {
  return {
    runId,
    mtimeMs,
    parent: manifest.parent,
    sessionId: manifest.sessionId,
    browserName: manifest.browserName,
    browserVersion: manifest.browserVersion,
    platformName: manifest.platformName,
    warn: input.warn
  }
}

/** Each test's preparation is deferred so its zip is parsed only when its spans are emitted. */
function planManifest(
  input: PushInput,
  { file, manifest, mtimeMs }: ManifestInput,
  runId: string,
  readTrace: (zipPath: string, dir: string) => TracePlayerData | undefined,
  isSuperseded: (test: ManifestTest) => boolean
): Array<() => PreparedTest> {
  const dir = path.dirname(file)
  const testUids = new Set(manifest.tests.map((test) => test.uid))
  const artifactsByUid = traceArtifactsByUid(manifest)
  const run = runContextOf(input, runId, manifest, mtimeMs)
  const pending: Array<() => PreparedTest> = []
  let warnedSharedZip = false
  for (const test of manifest.tests) {
    const artifact = artifactsByUid.get(test.uid)
    const sharedZip =
      artifact !== undefined &&
      (artifact.testUids.filter((uid) => testUids.has(uid)).length > 1 ||
        holdsEarlierAttempts(artifact, test))
    if (sharedZip && input.traceZips && !warnedSharedZip) {
      input.warn(
        `skipped action spans in ${file}: its zips cover several tests or attempts, so they are linked but not read; record with traceGranularity:'test' for per-test action spans`
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
              ? readTrace(zipPath, dir)
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

function warnStatelessTests(
  { file, manifest }: ManifestInput,
  warn: (message: string) => void
): void {
  const count = manifest.tests.filter((test) => test.state === undefined).length
  if (count > 0) {
    warn(
      `${count} test(s) in ${file} have no recorded outcome and are pushed without a status`
    )
  }
}

const FLUSH_AT_PENDING_SPANS = 4096

async function flushOrExplain(
  sink: TelemetrySink,
  emitted: number,
  total: number
): Promise<void> {
  try {
    await sink.flush()
  } catch (error) {
    const unsent =
      emitted < total
        ? `, and tests ${emitted + 1}..${total} were not sent`
        : ''
    throw Object.assign(
      new Error(
        `export failed: ${sink.exportedSpans()} span(s) reached the collector, ${sink.pendingSpans()} emitted span(s) did not${unsent}: ${describe(error)}`
      ),
      { cause: error }
    )
  }
}

export function planPush(input: PushInput): PushPlan {
  const reader = zipReader(input)
  const pushed = input.manifests.filter(
    ({ file, manifest }) =>
      input.ignoreParentSampling || !unsampledParent(file, manifest, input.warn)
  )
  const runIds = pushed.map(({ file, manifest }) =>
    runIdOf(file, manifest, input.runId, input.warn)
  )
  const runIdOfPushed = new Map(
    pushed.map((entry, index) => [entry, runIds[index]])
  )
  const isSuperseded = supersededFinals(
    input.manifests.map((entry) => ({
      ...entry,
      runId:
        runIdOfPushed.get(entry) ??
        runIdOf(entry.file, entry.manifest, input.runId, () => {})
    }))
  )
  const pending = pushed.flatMap((entry, index) => {
    warnStatelessTests(entry, input.warn)
    return planManifest(input, entry, runIds[index], reader.read, isSuperseded)
  })
  return {
    unreadable: () => reader.unreadable(),
    runIds: [...new Set(runIds)],
    pushedManifests: pushed.length,
    unsampledManifests: input.manifests.length - pushed.length,
    async emit(sink) {
      let emitted = 0
      for (const prepare of pending) {
        emitPrepared(sink, prepare(), input.consoleMessages)
        emitted++
        if (sink.pendingSpans() >= FLUSH_AT_PENDING_SPANS) {
          await flushOrExplain(sink, emitted, pending.length)
        }
      }
      await flushOrExplain(sink, emitted, pending.length)
      return pending.length
    }
  }
}
