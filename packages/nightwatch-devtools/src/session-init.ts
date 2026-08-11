/**
 * Session-initialization lifecycle helpers for the Nightwatch plugin.
 *
 * Extracted from the plugin class to keep `index.ts` under the file-size
 * cap. The plugin passes itself as a `SessionInitCtx` — a narrow interface
 * exposing only the fields and methods these helpers need.
 *
 * Includes:
 *   - Per-run bringup (capturer + reporter chain + metadata + BiDi + screencast)
 *   - Re-targeting that one capturer when the session under it is replaced
 *   - Re-arming the per-session capture channels when a session is replaced
 *   - Screencast finalize-and-clear
 *
 * The recorder's own session binding lives in `screencast-session.ts`.
 */

import logger from '@wdio/logger'
import {
  errorMessage,
  finalizeScreencast,
  registerCollectorPreload,
  resolveAdapterOutputDir
} from '@wdio/devtools-core'
import { TraceType } from './types.js'
import { TIMING } from './constants.js'
import { SessionCapturer } from './session.js'
import { TestReporter } from './reporter.js'
import { TestManager } from './helpers/testManager.js'
import { SuiteManager } from './helpers/suiteManager.js'
import { BrowserProxy } from './helpers/browserProxy.js'
import type { ScreencastRecorder } from './screencast.js'
import {
  rotateScreencastForSession,
  startScreencast
} from './screencast-session.js'
import type {
  DevToolsMode,
  NightwatchBrowser,
  ScreencastOptions,
  SuiteStats,
  TestRunnerId,
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
  readonly runner: TestRunnerId

  sessionCapturer: SessionCapturer
  testReporter: TestReporter
  testManager: TestManager
  suiteManager: SuiteManager
  browserProxy: BrowserProxy
  isScriptInjected: boolean

  lastSessionId: string | null
  /** Session the BiDi attach + collector preload were last armed for — the
   *  once-per-session guard for both, and the rotation detector. */
  armedSessionId: string | undefined
  srcFolders: string[]
  screencastRecorder: ScreencastRecorder | undefined
  screencastSessionId: string | undefined
  /** In-flight recorder rotation — see screencast-session.ts. */
  screencastRotation: Promise<void> | undefined
  configPath: string | undefined

  getCurrentTest(): unknown
  getCurrentScenarioSuite(): SuiteStats | null
  buildMetadataOptions(): unknown
  attemptFor(uid: string): number | undefined
  recordOutcome(uid: string, state: TestStats['state']): void
  /** Drains the live recorder's frames into the run's filmstrip buffer, then
   *  stops and clears it. */
  finalizeCurrentScreencast(): Promise<void>
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
    ctx.captureAssertions,
    // Nightwatch raises no session event and never wraps `end`, so a command
    // running under a new sessionId is the only trace a mid-run
    // `browser.end()` leaves behind. Both re-bindings hang off it; each latches
    // and gates itself, so neither can suppress the other.
    (browser) => {
      rotateScreencastForSession(ctx, browser)
      rearmCaptureForSession(ctx, browser)
    }
  )
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
    runner: ctx.runner,
    url: ''
  }
  // Single-valued, so a run-spanning trace carries the LAST session's identity.
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
// chromedriver. Attempted once per session (the caller's `armedSessionId` stamp
// is that guard); on failure or unavailability the perf-log fallback path
// continues to work.
async function tryAttachBidi(
  ctx: SessionInitCtx,
  browser: NightwatchBrowser
): Promise<void> {
  if (!ctx.bidiEnabled) {
    return
  }
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

/**
 * Register the collector to run at document-start, so every document — including
 * the ones a navigation creates without us noticing — instruments and anchors
 * itself.
 *
 * Deliberately NOT gated on the `bidi` option: that option exists to avoid
 * double-reporting console/network against the perf-log path, whereas this needs
 * nothing but a session created with `webSocketUrl: true`. Gating DOM capture on
 * an unrelated opt-in that defaults to false would leave the race in place for
 * almost every user. Self-degrades to the per-document `<script>` injection when
 * BiDi isn't there.
 */
async function tryRegisterPreload(
  ctx: SessionInitCtx,
  browser: NightwatchBrowser
): Promise<void> {
  const driver = (browser as { driver?: unknown }).driver
  if (!driver) {
    return
  }
  ctx.sessionCapturer.preloadRegistered = await registerCollectorPreload(
    driver,
    (level, message) => log[level](message)
  )
}

/**
 * Arm the two capture channels that belong to ONE WebDriver session: the BiDi
 * inspectors (bound to that session's driver object) and the document-start
 * collector preload (registered on that session's BiDi channel). Neither
 * survives the session, so a replaced session needs both again.
 *
 * The stamp is written before any await: on rotation this runs from the command
 * hook, where the next command arrives long before a BiDi round trip completes,
 * and the stamp is what keeps that flood from re-arming.
 *
 * The preload goes FIRST. Behind the attach it lost the race it exists to win —
 * measured on a re-arm, the network subscribe took 6.2 s while the command that
 * triggered the re-arm navigated, so the registration landed two seconds after
 * the document it was meant to instrument was born. Sequential rather than
 * parallel because both steps open the session's BiDi channel through the same
 * unsynchronized `getBidi()` cache, and racing them opens two websockets of
 * which `quit()` closes one.
 */
async function armCaptureForSession(
  ctx: SessionInitCtx,
  browser: NightwatchBrowser
): Promise<void> {
  ctx.armedSessionId = browser.sessionId ?? undefined
  await tryRegisterPreload(ctx, browser)
  await tryAttachBidi(ctx, browser)
}

/**
 * Whether the browser is executing under a session the capture channels were
 * never armed for. Requires an already-armed session: before bringup there is no
 * capturer to arm onto, and `ensureSessionInitialized` owns that first arm.
 */
export function needsCaptureRearm(
  ctx: Pick<SessionInitCtx, 'armedSessionId' | 'sessionCapturer'>,
  sessionId: string | undefined
): boolean {
  return (
    Boolean(ctx.sessionCapturer) &&
    sessionId !== undefined &&
    ctx.armedSessionId !== undefined &&
    ctx.armedSessionId !== sessionId
  )
}

/**
 * Re-arm BiDi and the collector preload after the session was replaced. Without
 * it both are established exactly once, at bringup, and sessions 2..N silently
 * fall back to `<script>` injection — the whole navigation race class the
 * preload exists to remove comes back for the rest of the run.
 *
 * The `needsCaptureRearm` guard is what makes it idempotent: the command hook
 * and `ensureSessionInitialized` both detect the same replacement, and
 * `armCaptureForSession` stamps `armedSessionId` before its first await, so
 * whichever gets there first latches the other out.
 */
async function armReplacedSession(
  ctx: SessionInitCtx,
  browser: NightwatchBrowser
): Promise<void> {
  const sessionId = browser.sessionId ?? undefined
  if (!needsCaptureRearm(ctx, sessionId)) {
    return
  }
  // Both claims belong to the session that just died. Until the new
  // registration lands this session's documents are back on the `<script>`
  // path — exactly what `anchorAfterNavigation` polls for — and a stale
  // `bidiActive` would keep the perf-log network path gated off behind
  // inspectors that no longer receive anything.
  ctx.sessionCapturer.preloadRegistered = false
  ctx.sessionCapturer.bidiActive = false
  log.info(`Session replaced — re-arming capture for ${sessionId}`)
  await armCaptureForSession(ctx, browser)
}

/** Fire-and-forget {@link armReplacedSession}, for the command hook — a command
 *  must not wait on a BiDi handshake. */
export function rearmCaptureForSession(
  ctx: SessionInitCtx,
  browser: NightwatchBrowser
): void {
  void armReplacedSession(ctx, browser).catch((err) =>
    log.warn(`Capture re-arm failed: ${errorMessage(err)}`)
  )
}

/** Re-run the per-session bringup against a replaced session, keeping the run's
 *  one capturer. Both halves are the guarded helpers the command hook uses, so a
 *  replacement both paths see is armed and rotated once. */
async function rebindSessionToBrowser(
  ctx: SessionInitCtx,
  browser: NightwatchBrowser
): Promise<void> {
  log.info('Browser session changed — re-targeting the run capturer')
  // Also gates `wrapUrlMethod`, which is per browser OBJECT — cucumber hands
  // over a new one per scenario.
  ctx.isScriptInjected = false
  broadcastSessionMetadata(ctx, browser)
  await armReplacedSession(ctx, browser)
  rotateScreencastForSession(ctx, browser)
  await ctx.screencastRotation
}

export async function ensureSessionInitialized(
  ctx: SessionInitCtx,
  browser: NightwatchBrowser
): Promise<void> {
  const currentSessionId = browser.sessionId
  const isSessionChange =
    currentSessionId &&
    ctx.lastSessionId &&
    currentSessionId !== ctx.lastSessionId
  ctx.lastSessionId = currentSessionId ?? null
  if (ctx.sessionCapturer) {
    // Unconditional: cucumber hands over a new browser object per scenario, and
    // a stale reference answers neither probe the capturer runs against it.
    ctx.sessionCapturer.setBrowser(browser)
    if (isSessionChange) {
      await rebindSessionToBrowser(ctx, browser)
    }
    return
  }
  await new Promise((resolve) =>
    setTimeout(resolve, TIMING.INITIAL_CONNECTION_WAIT)
  )
  // Trace mode: empty opts skip SessionCapturerBase's WS init — no backend
  // to forward events to anyway.
  ctx.sessionCapturer = new SessionCapturer(
    ctx.mode === 'trace' ? {} : { port: ctx.port, hostname: ctx.hostname },
    browser
  )
  ctx.sessionCapturer.traceMode = ctx.mode
  ctx.sessionCapturer.runner = ctx.runner
  if (ctx.mode !== 'trace') {
    const connected = await ctx.sessionCapturer.waitForConnection(3000)
    if (!connected) {
      log.error('❌ Worker WebSocket failed to connect!')
    }
  }
  initReporterChain(ctx)
  broadcastSessionMetadata(ctx, browser)
  await armCaptureForSession(ctx, browser)
  await startScreencast(ctx, browser, browser.sessionId)
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
