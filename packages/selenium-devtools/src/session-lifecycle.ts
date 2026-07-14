/**
 * Session lifecycle for the Selenium plugin — driver bringup, per-driver
 * capture wiring (metadata + screencast + BiDi), per-driver teardown, and
 * end-of-run shutdown.
 *
 * Extracted from `index.ts` to keep that file under the file-size cap. The
 * plugin passes itself as a `SessionLifecycleCtx` — a narrow interface
 * exposing only the fields and methods these helpers need.
 */

import logger from '@wdio/logger'
import {
  collectSuiteTestMetadata,
  errorMessage,
  finalizeScreencast,
  finalizeTraceExport,
  findFlushableRange,
  flushRangeLogged,
  recordSliceBoundary as coreRecordSliceBoundary,
  recordSpecBoundary as coreRecordSpecBoundary,
  resolveAdapterOutputDir,
  type SpecBoundaryContext,
  type SpecRange,
  type TraceArtifact,
  type TraceExportContext
} from '@wdio/devtools-core'
import { TIMING } from './constants.js'
import { SessionCapturer } from './session.js'
import { TestReporter } from './reporter.js'
import { SuiteManager } from './helpers/suiteManager.js'
import { ScreencastRecorder } from './screencast.js'
import { buildDriverMetadata } from './helpers/driverMetadata.js'
import { attachBidiHandlers, buildBidiSinks } from './bidi.js'
import { gracefulShutdown } from './helpers/processHooks.js'
import type {
  ActionSnapshot,
  DevToolsMode,
  Metadata,
  ScreencastOptions,
  SeleniumDriverLike,
  TraceFormat,
  TraceGranularity,
  TraceRetentionPolicy
} from './types.js'
import type { TestManager } from './helpers/testManager.js'

const log = logger('@wdio/selenium-devtools:session-lifecycle')

export interface SessionLifecycleCtx {
  readonly options: {
    hostname: string
    port: number
    openUi: boolean
    captureScreenshots: boolean
    rerunCommand?: string
    mode?: DevToolsMode
    traceFormat?: TraceFormat
    traceGranularity?: TraceGranularity
    tracePolicy?: TraceRetentionPolicy
  }
  readonly screencastOptions: ScreencastOptions
  readonly runner: string
  readonly rerunTemplate: string | undefined
  readonly launchCommand: string | undefined
  readonly isReuse: boolean
  readonly finalized: boolean

  driver: SeleniumDriverLike | undefined
  sessionCapturer: SessionCapturer | undefined
  testReporter: TestReporter | undefined
  suiteManager: SuiteManager | undefined
  testManager: TestManager | undefined
  screencast: ScreencastRecorder | undefined
  sessionId: string | undefined
  scriptInjected: boolean
  testFilePath: string | undefined
  keepAliveTimer: ReturnType<typeof setInterval> | undefined

  // Populated by handleOnCommand when mode === 'trace'.
  readonly actionSnapshots: ActionSnapshot[]
  readonly snapshotCaptures: Promise<void>[]

  // Per-spec trace tracking (populated at spec file boundaries).
  readonly specRanges: SpecRange[]
  readonly flushedSpecs: Set<string>
  // In-flight per-test eager flushes (test granularity); awaited at finalize
  // so the last test's write completes before the process exits.
  readonly traceFlushes: Promise<unknown>[]
  // Every trace/video artifact seen this run, for the end-of-run manifest.
  readonly artifacts: TraceArtifact[]

  setFinalized(v: boolean): void
  ensureBackendStarted(): Promise<void>
  flushPendingTestActions(): void
  resetRetryTracker(): void
  clearKeepAlive(): void
}

export async function onDriverCreated(
  ctx: SessionLifecycleCtx,
  driver: SeleniumDriverLike
): Promise<void> {
  const driverReadyTs = Date.now()
  await ctx.ensureBackendStarted()

  if (ctx.driver === driver) {
    return
  }

  // Fresh-driver-per-test: re-target capturer; reuse suite/reporter/testManager.
  if (ctx.driver || ctx.sessionCapturer) {
    log.info('New driver detected — re-targeting capturer for next test')
    ctx.driver = driver
    ctx.sessionCapturer?.setDriver(driver)
    await initPerDriverCapture(ctx, driver, driverReadyTs)
    return
  }

  ctx.driver = driver
  // In trace mode there's no backend to forward events to — pass an empty
  // opts bag so SessionCapturerBase skips its WS init.
  ctx.sessionCapturer = new SessionCapturer(
    ctx.options.mode === 'trace'
      ? {}
      : { hostname: ctx.options.hostname, port: ctx.options.port },
    driver
  )
  // Dashboard closed AFTER tests finished → wind the runner down so the user
  // doesn't have to Ctrl+C. Ignore during a live run: a momentary reconnect
  // blip during tests must not abort them.
  ctx.sessionCapturer.setClientDisconnectedHandler(() => {
    if (ctx.finalized) {
      void gracefulShutdown(
        ctxPluginRef(ctx) as Parameters<typeof gracefulShutdown>[0],
        0
      )
    }
  })
  await ctx.sessionCapturer.waitForConnection(TIMING.UI_CONNECTION_WAIT)

  ctx.testReporter = new TestReporter((suitesData) => {
    ctx.sessionCapturer?.sendUpstream('suites', suitesData)
  })
  ctx.suiteManager = new SuiteManager(ctx.testReporter)
  ctx.flushPendingTestActions()

  await initPerDriverCapture(ctx, driver, driverReadyTs)
}

// gracefulShutdown signature takes the whole plugin instance, not the ctx.
// We pass the plugin through ctx's closure by attaching it under a symbol.
const PLUGIN_REF = Symbol.for('@wdio/selenium-devtools/plugin-ref')
export function setPluginRef(ctx: SessionLifecycleCtx, plugin: unknown): void {
  ;(ctx as unknown as Record<symbol, unknown>)[PLUGIN_REF] = plugin
}
function ctxPluginRef(ctx: SessionLifecycleCtx): unknown {
  return (ctx as unknown as Record<symbol, unknown>)[PLUGIN_REF]
}

async function initPerDriverCapture(
  ctx: SessionLifecycleCtx,
  driver: SeleniumDriverLike,
  driverReadyTs: number
): Promise<void> {
  if (!ctx.sessionCapturer) {
    return
  }

  const { sessionId, metadata } = await buildDriverMetadata({
    driver,
    driverReadyTs,
    runner: ctx.runner,
    rerunCommand: ctx.options.rerunCommand,
    rerunTemplate: ctx.rerunTemplate,
    launchCommand: ctx.launchCommand
  })
  ctx.sessionId = sessionId
  if (metadata) {
    // buildDriverMetadata returns a Record-shaped payload; the relevant
    // Metadata fields (sessionId, capabilities, viewport, ...) are present
    // at runtime but TS can't prove the discriminant `type`.
    ctx.sessionCapturer.metadata = metadata as unknown as Metadata
    ctx.sessionCapturer.sendUpstream('metadata', metadata)
  }

  // Parallel — serial attach misses frames on fast tests.
  const screencastPromise = ctx.screencastOptions.enabled
    ? (async () => {
        try {
          ctx.screencast = new ScreencastRecorder(ctx.screencastOptions)
          await ctx.screencast.start(driver)
        } catch (err) {
          log.warn(`Screencast start failed: ${errorMessage(err)}`)
        }
      })()
    : Promise.resolve()

  const bidiPromise = (async () => {
    try {
      const sinks = buildBidiSinks(ctx.sessionCapturer!)
      const ok = await attachBidiHandlers(driver, sinks)
      if (ok) {
        ctx.sessionCapturer!.bidiActive = true
        log.info(
          '✓ BiDi data flow active — script-injected console/network suppressed'
        )
      }
    } catch (err) {
      log.warn(`BiDi attach threw: ${errorMessage(err)}`)
    }
  })()

  await Promise.all([screencastPromise, bidiPromise])
}

export async function onDriverEnd(ctx: SessionLifecycleCtx): Promise<void> {
  if (ctx.screencast && ctx.sessionId) {
    await finalizeScreencast({
      recorder: ctx.screencast,
      sessionId: ctx.sessionId,
      filenamePrefix: 'selenium-video',
      outputDir: resolveAdapterOutputDir({
        testFilePath: ctx.testFilePath
      }),
      captureFormat: ctx.screencastOptions.captureFormat,
      sendUpstream: (scope, data) =>
        ctx.sessionCapturer?.sendUpstream(scope, data),
      onLog: (level, message) => log[level](message)
    })
  }
  ctx.driver = undefined
  ctx.screencast = undefined
  ctx.scriptInjected = false
  ctx.sessionId = undefined
  ctx.resetRetryTracker()
}

/** Final teardown. Idempotent. */
export async function onSessionEnd(ctx: SessionLifecycleCtx): Promise<void> {
  if (ctx.finalized) {
    return
  }
  ctx.setFinalized(true)
  const shutdownStart = Date.now()
  // Capture for the trace.zip write before onDriverEnd clears ctx state.
  const capturerAtStart = ctx.sessionCapturer
  const testFilePathAtStart = ctx.testFilePath
  try {
    await onDriverEnd(ctx).catch(() => {})

    // Don't call suiteManager.finalize() here — it sets `root.end`, which
    // signals the dashboard's rerun tracker that the feature has finished
    // and unblocks the new-run reset for the next scenario. onSessionEnd
    // fires on each `driver.quit()` (per cucumber scenario), so finalizing
    // the root here is premature. The true end-of-run finalize happens in
    // finalizeTestRun (cucumber AfterAll). testReporter.updateSuites() is
    // still useful to flush per-scenario state to the dashboard.
    ctx.testManager?.finalizeSession()
    ctx.testReporter?.updateSuites()

    await writeTraceIfNeeded(ctx, capturerAtStart, testFilePathAtStart)

    logSessionSummary(ctx)
    ctx.sessionCapturer?.cleanup()

    if (ctx.options.openUi && ctx.options.mode !== 'trace' && !ctx.isReuse) {
      handleInteractivePath(ctx, shutdownStart)
      return
    }

    // trace mode: no UI to wait for; close the WS so the backend can wind
    // down naturally. process.exit is avoided — Jest/runners may treat
    // forced exits as failures.
    if (ctx.options.mode === 'trace' && !ctx.isReuse) {
      try {
        await ctx.sessionCapturer?.closeWebSocket()
      } catch {
        /* best-effort */
      }
      log.info(`🛑 Shutdown complete (${Date.now() - shutdownStart}ms)`)
      return
    }

    // Non-interactive path (no dashboard or rerun child). Don't close the
    // WS yet: this `onSessionEnd` is reached via the patched `driver.quit()`
    // (cucumber's per-scenario `After` hook), but the runner's
    // `onScenarioEnd` hook fires AFTER `After`. Closing the WS here would
    // drop the final state update. Defer the close to `beforeExit`/`exit`,
    // by which time every post-quit runner hook has flushed.
    log.info(`🛑 Session ended (${Date.now() - shutdownStart}ms)`)
  } catch (err) {
    log.warn(`Cleanup error: ${errorMessage(err)}`)
  }
}

/**
 * Assemble the framework-agnostic trace-export context from the selenium
 * session state. `resolveOutputDir` writes per-spec traces next to the spec
 * file and the session trace next to the run's first test file. Test metadata
 * is recomputed from the suite tree so a boundary flush sees the current tree.
 */
export function buildTraceExportContext(
  ctx: SessionLifecycleCtx,
  capturer: SessionCapturer,
  sessionId: string,
  testFilePath: string | undefined
): TraceExportContext {
  const root = ctx.suiteManager?.getRootSuite()
  return {
    mode: ctx.options.mode,
    policy: ctx.options.tracePolicy,
    granularity: ctx.options.traceGranularity,
    format: ctx.options.traceFormat,
    capturer,
    actionSnapshots: ctx.actionSnapshots,
    sessionId,
    testMetadata: collectSuiteTestMetadata(root ? [root] : []),
    // TestStats.retries carries the per-test attempt (Mocha authoritative,
    // other runners heuristic), so retry-aware policies can trust it.
    attemptInfoAvailable: true,
    // Per-attempt outcome ledger, retry-stable-keyed so a test's attempts
    // group as one test. Without it, session/spec retention reads the
    // per-attempt suite-node metadata — which sees a fail-then-pass as two
    // separate one-shot tests and over-retains it under retain-on-failure.
    outcomes: ctx.testManager?.attemptOutcomes,
    ranges: ctx.specRanges,
    flushed: ctx.flushedSpecs,
    resolveOutputDir: (range) =>
      resolveAdapterOutputDir({
        testFilePath: range ? range.specFile : testFilePath
      }),
    awaitPending: [...ctx.snapshotCaptures, ...ctx.traceFlushes],
    log: (level, msg) => log[level](msg),
    emitManifest: true,
    collectedArtifacts: ctx.artifacts,
    onArtifact: (a) => ctx.artifacts.push(a)
  }
}

/** Narrow view of the lifecycle ctx that the core boundary recorder needs. */
function boundaryContext(
  ctx: SessionLifecycleCtx,
  capturer: SessionCapturer
): SpecBoundaryContext {
  return {
    specRanges: ctx.specRanges,
    flushedSpecs: ctx.flushedSpecs,
    capturer,
    actionSnapshots: ctx.actionSnapshots
  }
}

/**
 * Record a trace-slice boundary for the active granularity, called from the
 * plugin's startTest / startScenario. `spec` keys by spec file (flushing the
 * previous spec lazily at the next boundary); `test` keys by the just-started
 * marked test's uid so each test — and each retry, which selenium gives a
 * distinct uid — becomes its own slice. No-op for `session`.
 */
export function recordTraceBoundary(
  ctx: SessionLifecycleCtx,
  specFile: string | undefined
): void {
  if (ctx.options.traceGranularity === 'test') {
    recordTestBoundary(ctx, specFile)
    return
  }
  if (specFile) {
    recordSpecBoundary(ctx, specFile)
  }
}

/**
 * Record a spec-file boundary and lazily flush the previous spec's trace if it
 * hasn't been written yet. `coreRecordSpecBoundary` no-ops for non-spec
 * granularities, so this only records under `spec`.
 */
function recordSpecBoundary(ctx: SessionLifecycleCtx, specFile: string): void {
  if (!ctx.sessionCapturer) {
    return
  }
  const prevRange = coreRecordSpecBoundary(
    boundaryContext(ctx, ctx.sessionCapturer),
    specFile,
    ctx.options.traceGranularity
  )
  const sessionId = ctx.sessionCapturer.metadata?.sessionId
  if (!prevRange || !sessionId) {
    return
  }
  void flushRangeLogged(
    buildTraceExportContext(
      ctx,
      ctx.sessionCapturer,
      sessionId,
      ctx.testFilePath
    ),
    prevRange
  )
}

/**
 * Record a per-test boundary keyed by the currently-active marked test's uid.
 * The first test's startTest fires before the driver exists (no capturer yet),
 * so flushPendingTestActions re-invokes this once capture is live; the
 * same-uid guard keeps that replay from minting a spurious retry slice.
 */
function recordTestBoundary(
  ctx: SessionLifecycleCtx,
  specFile: string | undefined
): void {
  const testUid = ctx.testManager?.getCurrentTest()?.uid
  const file = specFile ?? ctx.testFilePath
  if (!ctx.sessionCapturer || !testUid || !file) {
    return
  }
  const lastRange = ctx.specRanges[ctx.specRanges.length - 1]
  if (lastRange?.testUid === testUid) {
    return
  }
  coreRecordSliceBoundary(
    boundaryContext(ctx, ctx.sessionCapturer),
    'test',
    file,
    testUid
  )
}

/**
 * Eager-flush the just-ended test's trace slice (test granularity), after
 * endTest has finalized its state so collectSuiteTestMetadata sees the final
 * outcome. flushRangeTrace dedupes by key, so finalizeTraceExport won't
 * re-write it; the promise is tracked so finalize awaits the last write.
 */
export function flushCurrentTestTrace(ctx: SessionLifecycleCtx): void {
  if (ctx.options.traceGranularity !== 'test' || !ctx.sessionCapturer) {
    return
  }
  const sessionId = ctx.sessionCapturer.metadata?.sessionId
  const currentRange = findFlushableRange(ctx.specRanges)
  if (!sessionId || currentRange?.testUid === undefined) {
    return
  }
  const flush = flushRangeLogged(
    buildTraceExportContext(
      ctx,
      ctx.sessionCapturer,
      sessionId,
      ctx.testFilePath
    ),
    currentRange
  )
  ctx.traceFlushes.push(flush)
}

async function writeTraceIfNeeded(
  ctx: SessionLifecycleCtx,
  capturer: SessionCapturer | undefined,
  testFilePath: string | undefined
): Promise<void> {
  const sessionId = capturer?.metadata?.sessionId
  if (ctx.options.mode !== 'trace' || !capturer || !sessionId) {
    return
  }
  await finalizeTraceExport(
    buildTraceExportContext(ctx, capturer, sessionId, testFilePath)
  )
}

function logSessionSummary(ctx: SessionLifecycleCtx): void {
  const cmdCount = ctx.sessionCapturer?.commandsLog.length ?? 0
  const consoleCount = ctx.sessionCapturer?.consoleLogs.length ?? 0
  const networkCount = ctx.sessionCapturer?.networkRequests.length ?? 0
  log.info(
    `📊 Session summary — ${cmdCount} command(s), ${networkCount} network request(s), ${consoleCount} console log(s)`
  )
}

function handleInteractivePath(
  ctx: SessionLifecycleCtx,
  shutdownStart: number
): void {
  log.info(
    `💡 Tests complete — DevTools UI: http://${ctx.options.hostname}:${ctx.options.port}`
  )
  log.info('🔵 Close the DevTools browser window (or press Ctrl+C) to finish')
  ctx.keepAliveTimer = setInterval(() => {}, 60 * 60 * 1000)
  ctx.sessionCapturer?.setClientDisconnectedHandler(() => {
    log.info('Dashboard closed — shutting down')
    ctx.clearKeepAlive()
    void completeShutdown(ctx, shutdownStart)
  })
}

/**
 * Final cleanup once the user has closed the dashboard browser. Drives the
 * remaining teardown explicitly and `exit(0)`s — the natural event-loop
 * drain doesn't fire reliably because the detached backend's own close
 * races with the worker WS close.
 */
export async function completeShutdown(
  ctx: SessionLifecycleCtx,
  shutdownStart: number
): Promise<void> {
  try {
    await ctx.sessionCapturer?.closeWebSocket()
  } catch {
    /* best-effort */
  }
  log.info(`🛑 Shutdown complete (${Date.now() - shutdownStart}ms)`)
  process.exit(0)
}
