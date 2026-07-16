/**
 * Session-initialization lifecycle helpers for the Nightwatch plugin.
 *
 * Extracted from the plugin class to keep `index.ts` under the file-size
 * cap. The plugin passes itself as a `SessionInitCtx` — a narrow interface
 * exposing only the fields and methods these helpers need.
 *
 * Includes:
 *   - Per-session bringup (capturer + reporter chain + metadata + BiDi + screencast)
 *   - Session-change cleanup
 *   - Screencast finalize-and-clear
 */

import logger from '@wdio/logger'
import {
  finalizeScreencast,
  resolveAdapterOutputDir
} from '@wdio/devtools-core'
import { TraceType } from './types.js'
import { TIMING } from './constants.js'
import { SessionCapturer } from './session.js'
import { TestReporter } from './reporter.js'
import { TestManager } from './helpers/testManager.js'
import { SuiteManager } from './helpers/suiteManager.js'
import { BrowserProxy } from './helpers/browserProxy.js'
import { ScreencastRecorder } from './screencast.js'
import type {
  DevToolsMode,
  NightwatchBrowser,
  ScreencastOptions,
  SuiteStats,
  TestStats
} from './types.js'

const log = logger('@wdio/nightwatch-devtools:session-init')

export interface SessionInitCtx {
  readonly hostname: string
  readonly port: number
  readonly screencastOptions: ScreencastOptions
  readonly bidiEnabled: boolean
  readonly mode: DevToolsMode
  readonly captureAssertions: boolean

  sessionCapturer: SessionCapturer
  testReporter: TestReporter
  testManager: TestManager
  suiteManager: SuiteManager
  browserProxy: BrowserProxy
  isScriptInjected: boolean

  lastSessionId: string | null
  bidiAttachAttempted: boolean
  srcFolders: string[]
  screencastRecorder: ScreencastRecorder | undefined
  screencastSessionId: string | undefined
  configPath: string | undefined

  getCurrentTest(): unknown
  getCurrentScenarioSuite(): SuiteStats | null
  buildMetadataOptions(): unknown
  attemptFor(uid: string): number | undefined
  recordOutcome(uid: string, state: TestStats['state']): void
}

async function handleSessionChange(
  ctx: SessionInitCtx,
  finalizeCurrent: () => Promise<void>
): Promise<void> {
  log.info('Browser session changed — reconnecting WebSocket only')
  ctx.isScriptInjected = false
  // Reset BiDi-attach state so the new session gets its own attach —
  // inspectors are bound to a specific driver instance and don't carry
  // across sessions. Without this, only the first session captures via
  // BiDi and the rest silently fall back to the perf-log path.
  ctx.bidiAttachAttempted = false
  // Finalize the previous session's screencast BEFORE we tear down its
  // capturer — encode + broadcast use the existing WS connection.
  await finalizeCurrent()
  ctx.sessionCapturer?.cleanup()
  // Intentional null-out — the next call to ensureSessionInitialized
  // reassigns. Cast through unknown so the strict field type passes.
  ctx.sessionCapturer = null as unknown as SessionCapturer
}

function initReporterChain(ctx: SessionInitCtx): void {
  // First-time setup: create reporter chain once for the entire run.
  // These must NOT be recreated on session change — doing so generates a
  // new feature suite with a fresh start timestamp, which DataManager sees
  // as a new run and wipes all accumulated commands.
  ctx.testReporter = new TestReporter(
    (suitesData) => {
      if (ctx.sessionCapturer) {
        ctx.sessionCapturer.sendUpstream('suites', suitesData)
      }
    },
    (uid) => ctx.attemptFor(uid)
  )
  ctx.testManager = new TestManager(ctx.testReporter, (uid, state) =>
    ctx.recordOutcome(uid, state)
  )
  ctx.suiteManager = new SuiteManager(ctx.testReporter)
  ctx.browserProxy = new BrowserProxy(
    ctx.sessionCapturer,
    ctx.testManager,
    () => ctx.getCurrentTest() ?? ctx.getCurrentScenarioSuite(),
    ctx.captureAssertions
  )
}

function rebindReporterToNewSession(ctx: SessionInitCtx): void {
  // Session change: update the reporter's upstream callback to use the new
  // WebSocket, update the proxy's capturer reference (avoids re-wrapping
  // already-wrapped browser methods which would double-capture commands),
  // then replay current suite state to the newly-connected UI.
  ctx.testReporter.updateUpstream((suitesData) => {
    if (ctx.sessionCapturer) {
      ctx.sessionCapturer.sendUpstream('suites', suitesData)
    }
  })
  ctx.browserProxy.updateSessionCapturer(ctx.sessionCapturer)
  ctx.testReporter.updateSuites()
}

function broadcastSessionMetadata(
  ctx: SessionInitCtx,
  browser: NightwatchBrowser
): void {
  const capabilities = browser.capabilities || {}
  const desiredCapabilities = browser.desiredCapabilities || {}
  const sessionId = browser.sessionId
  const opts = browser.options || {}

  if (ctx.srcFolders.length === 0) {
    const sf = (opts as { src_folders?: string | string[] }).src_folders
    ctx.srcFolders = Array.isArray(sf) ? sf : sf ? [sf] : []
  }

  const metadata = {
    type: TraceType.Testrunner,
    capabilities,
    desiredCapabilities,
    sessionId,
    testEnv: opts.testEnv,
    host: opts.webdriver?.host,
    options: ctx.buildMetadataOptions(),
    url: ''
  }
  ctx.sessionCapturer.metadata = metadata
  ctx.sessionCapturer.sendUpstream('metadata', metadata)

  const browserName =
    capabilities.browserName || desiredCapabilities.browserName || 'unknown'
  const browserVersion =
    capabilities.browserVersion ||
    (capabilities as { version?: string }).version ||
    ''
  log.info(
    `✓ Browser: ${browserName}${browserVersion ? ' ' + browserVersion : ''} (session: ${sessionId})`
  )

  const loggingPrefs = ((capabilities as Record<string, unknown>)[
    'goog:loggingPrefs'
  ] ||
    (desiredCapabilities as Record<string, unknown>)['goog:loggingPrefs'] ||
    {}) as { performance?: string }
  if (!loggingPrefs.performance && !ctx.bidiEnabled) {
    log.warn(
      "⚠  Network tab will be empty — add 'goog:loggingPrefs': { performance: 'ALL' } to your capabilities (or enable bidi:true)"
    )
  }
}

// BiDi: opt-in. Requires `webSocketUrl: true` capability + a BiDi-capable
// chromedriver. We attempt once per session; on failure or unavailability
// the perf-log fallback path continues to work.
async function tryAttachBidi(
  ctx: SessionInitCtx,
  browser: NightwatchBrowser
): Promise<void> {
  if (!ctx.bidiEnabled || ctx.bidiAttachAttempted) {
    return
  }
  ctx.bidiAttachAttempted = true
  const driver = (browser as { driver?: unknown }).driver
  if (!driver) {
    log.warn('bidi:true set but browser.driver unavailable — skipping')
    return
  }
  const { attachBidiHandlers, buildBidiSinks } = await import('./bidi.js')
  const ok = await attachBidiHandlers(
    driver,
    buildBidiSinks(ctx.sessionCapturer)
  )
  if (ok) {
    ctx.sessionCapturer.bidiActive = true
    log.info('✓ BiDi attached — perf-log network capture disabled')
  }
}

// Screencast: start a fresh recorder per browser session — every
// reloadSession / per-test browser produces its own .webm, matching
// the WDIO service behavior. Polling mode only (Nightwatch has no
// stable CDP escape hatch). Finalized when the next session change
// fires or when after() runs.
async function tryStartScreencast(
  ctx: SessionInitCtx,
  browser: NightwatchBrowser,
  sessionId: string | undefined
): Promise<void> {
  if (!ctx.screencastOptions.enabled || ctx.screencastRecorder || !sessionId) {
    return
  }
  ctx.screencastRecorder = new ScreencastRecorder(
    ctx.sessionCapturer,
    ctx.screencastOptions
  )
  ctx.screencastSessionId = sessionId
  log.info(`🎬 Starting screencast for session ${sessionId}`)
  await ctx.screencastRecorder.start(browser)
}

export async function ensureSessionInitialized(
  ctx: SessionInitCtx,
  browser: NightwatchBrowser,
  finalizeCurrentScreencast: () => Promise<void>
): Promise<void> {
  const currentSessionId = browser.sessionId
  const isSessionChange =
    currentSessionId &&
    ctx.lastSessionId &&
    currentSessionId !== ctx.lastSessionId
  if (isSessionChange) {
    await handleSessionChange(ctx, finalizeCurrentScreencast)
  }
  ctx.lastSessionId = currentSessionId ?? null
  if (ctx.sessionCapturer) {
    return
  }
  await new Promise((resolve) =>
    setTimeout(resolve, TIMING.INITIAL_CONNECTION_WAIT)
  )
  // Trace mode: empty opts skip SessionCapturerBase's WS init — no backend
  // to forward events to anyway.
  ctx.sessionCapturer = new SessionCapturer(
    ctx.mode === 'trace'
      ? {}
      : {
          port: ctx.port,
          hostname: ctx.hostname,
          // A session change reopens the WS mid-run — tell the backend to keep
          // the accumulated run state so earlier tests' commands survive.
          reconnect: Boolean(isSessionChange)
        },
    browser
  )
  ctx.sessionCapturer.traceMode = ctx.mode
  if (ctx.mode !== 'trace') {
    const connected = await ctx.sessionCapturer.waitForConnection(3000)
    if (!connected) {
      log.error('❌ Worker WebSocket failed to connect!')
    }
  }
  if (!ctx.testReporter) {
    initReporterChain(ctx)
  } else {
    rebindReporterToNewSession(ctx)
  }
  broadcastSessionMetadata(ctx, browser)
  await tryAttachBidi(ctx, browser)
  await tryStartScreencast(ctx, browser, browser.sessionId)
}

export async function finalizeCurrentScreencast(
  ctx: SessionInitCtx
): Promise<void> {
  if (!ctx.screencastRecorder || !ctx.screencastSessionId) {
    return
  }
  if (ctx.mode === 'trace') {
    // Trace mode: the per-test video is written by the produce path and the
    // filmstrip frames are embedded in the trace itself, so stop the recorder
    // without encoding a session .webm nothing references (orphan file).
    await ctx.screencastRecorder.stop()
  } else {
    await finalizeScreencast({
      recorder: ctx.screencastRecorder,
      sessionId: ctx.screencastSessionId,
      filenamePrefix: 'nightwatch-video',
      outputDir: resolveAdapterOutputDir({
        testFilePath: ctx.browserProxy?.getCurrentTestFullPath?.() ?? undefined,
        configPath: ctx.configPath
      }),
      captureFormat: ctx.screencastOptions.captureFormat,
      sendUpstream: (scope, data) =>
        ctx.sessionCapturer?.sendUpstream(scope, data),
      onLog: (level, message) => log[level](message)
    })
  }
  ctx.screencastRecorder = undefined
  ctx.screencastSessionId = undefined
}
