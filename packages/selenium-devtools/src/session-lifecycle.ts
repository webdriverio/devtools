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
  deterministicUid,
  errorMessage,
  finalizeScreencast,
  resolveAdapterOutputDir,
  writeTraceZip,
  type TraceCapturer
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
  SuiteStats,
  TraceFormat,
  TraceGranularity
} from './types.js'
import type { TestManager } from './helpers/testManager.js'

const log = logger('@wdio/selenium-devtools:session-lifecycle')

export interface SpecRange {
  specFile: string
  commandStartIdx: number
  consoleStartIdx: number
  networkStartIdx: number
  mutationStartIdx: number
  traceLogStartIdx: number
  snapshotCount: number
}

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

    await maybeWriteTrace(ctx, capturerAtStart, testFilePathAtStart)

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
 * Record a spec-file boundary in the session lifecycle context. Called from
 * the plugin's startTest / startScenario when `traceGranularity` is `'spec'`.
 * Flushes the previous spec's trace if it hasn't been written yet.
 */
export function recordSpecBoundary(
  ctx: SessionLifecycleCtx,
  specFile: string
): void {
  if (!ctx.sessionCapturer || ctx.options.traceGranularity !== 'spec') {
    return
  }
  const lastRange = ctx.specRanges[ctx.specRanges.length - 1]
  if (!lastRange || lastRange.specFile !== specFile) {
    if (lastRange && !ctx.flushedSpecs.has(lastRange.specFile)) {
      void flushOneSpecTrace(ctx, lastRange).catch((err) =>
        log.warn(
          `Failed to flush trace for spec "${lastRange.specFile}": ${errorMessage(err)}`
        )
      )
    }
    ctx.specRanges.push({
      specFile,
      commandStartIdx: ctx.sessionCapturer.commandsLog.length,
      consoleStartIdx: ctx.sessionCapturer.consoleLogs.length,
      networkStartIdx: ctx.sessionCapturer.networkRequests.length,
      mutationStartIdx: ctx.sessionCapturer.mutations.length,
      traceLogStartIdx: ctx.sessionCapturer.traceLogs.length,
      snapshotCount: ctx.actionSnapshots.length
    })
  }
}

async function flushOneSpecTrace(
  ctx: SessionLifecycleCtx,
  range: SpecRange,
  nextRange?: SpecRange
): Promise<string | undefined> {
  const capturer = ctx.sessionCapturer
  if (!capturer || ctx.flushedSpecs.has(range.specFile)) {
    return undefined
  }
  ctx.flushedSpecs.add(range.specFile)

  const sessionId = capturer.metadata?.sessionId
  if (!sessionId) {
    return undefined
  }

  const end = nextRange
    ? {
        commands: nextRange.commandStartIdx,
        console: nextRange.consoleStartIdx,
        network: nextRange.networkStartIdx,
        mutations: nextRange.mutationStartIdx,
        traceLogs: nextRange.traceLogStartIdx
      }
    : undefined

  const slice = <T>(arr: T[], start: number, endIdx?: number): T[] =>
    arr.slice(start, endIdx)

  const specCapturer: TraceCapturer = {
    mutations: slice(
      capturer.mutations,
      range.mutationStartIdx,
      end?.mutations
    ),
    traceLogs: slice(
      capturer.traceLogs,
      range.traceLogStartIdx,
      end?.traceLogs
    ),
    consoleLogs: slice(
      capturer.consoleLogs,
      range.consoleStartIdx,
      end?.console
    ),
    networkRequests: slice(
      capturer.networkRequests,
      range.networkStartIdx,
      end?.network
    ),
    commandsLog: slice(
      capturer.commandsLog,
      range.commandStartIdx,
      end?.commands
    ),
    sources: capturer.sources,
    metadata: capturer.metadata
  }

  const specSnapshots = ctx.actionSnapshots.slice(
    range.snapshotCount,
    nextRange?.snapshotCount ?? ctx.actionSnapshots.length
  )

  const sanitizedSpec =
    range.specFile
      .replace(/^.*[/\\]/, '')
      .replace(/\.[^.]+$/, '')
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .replace(/^_+|_+$/g, '') || 'unknown-spec'

  const hash = deterministicUid(range.specFile).split('-').pop()!.slice(0, 8)
  const specSessionId = `${sanitizedSpec}-${hash}-${sessionId.slice(0, 8)}`

  // Collect test metadata scoped to this spec file.
  const testMetadata = new Map<string, { title: string; specFile: string }>()
  const allMetadata = collectTestMetadata(ctx.suiteManager)
  for (const [uid, meta] of allMetadata) {
    if (meta.specFile === range.specFile) {
      testMetadata.set(uid, meta)
    }
  }

  const tracePath = await writeTraceZip(specCapturer, {
    outputDir: resolveAdapterOutputDir({ testFilePath: range.specFile }),
    sessionId: specSessionId,
    actionSnapshots: specSnapshots.length > 0 ? specSnapshots : undefined,
    format: ctx.options.traceFormat,
    testMetadata
  })
  log.info(`Trace for spec "${range.specFile}" saved to ${tracePath}`)
  return tracePath
}

async function flushSpecTraces(ctx: SessionLifecycleCtx): Promise<void> {
  for (const range of ctx.specRanges) {
    if (!ctx.flushedSpecs.has(range.specFile)) {
      await flushOneSpecTrace(ctx, range)
    }
  }
}

function collectTestMetadata(
  suiteManager: SuiteManager | undefined
): Map<string, { title: string; specFile: string }> {
  const metadata = new Map<string, { title: string; specFile: string }>()
  const root = suiteManager?.getRootSuite()
  if (!root) {
    return metadata
  }
  const walk = (suite: SuiteStats) => {
    for (const entry of suite.tests) {
      if (typeof entry === 'string') {
        continue
      }
      metadata.set(entry.uid, {
        title: entry.fullTitle,
        specFile: entry.file
      })
    }
    for (const child of suite.suites) {
      walk(child)
    }
  }
  walk(root)
  return metadata
}

async function maybeWriteTrace(
  ctx: SessionLifecycleCtx,
  capturer: SessionCapturer | undefined,
  testFilePath: string | undefined
): Promise<void> {
  const sessionId = capturer?.metadata?.sessionId
  if (ctx.options.mode !== 'trace' || !capturer || !sessionId) {
    return
  }
  try {
    if (ctx.snapshotCaptures.length) {
      await Promise.allSettled(ctx.snapshotCaptures)
    }

    if (ctx.options.traceGranularity === 'spec') {
      await flushSpecTraces(ctx)
      return
    }

    const testMetadata = collectTestMetadata(ctx.suiteManager)
    const tracePath = await writeTraceZip(capturer, {
      outputDir: resolveAdapterOutputDir({ testFilePath }),
      sessionId,
      actionSnapshots: ctx.actionSnapshots.length
        ? ctx.actionSnapshots
        : undefined,
      format: ctx.options.traceFormat,
      testMetadata
    })
    log.info(`Trace saved to ${tracePath}`)
  } catch (err) {
    log.warn(`trace write failed: ${errorMessage(err)}`)
  }
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
