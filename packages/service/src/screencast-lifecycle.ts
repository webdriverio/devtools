// Owns the WDIO run's screencast: the recorder across reloadSession boundaries,
// the filmstrip frame buffer that outlives each session, and the per-test video
// slice. The plugin only forwards its hooks here — everything that reads or
// writes recorder frames lives in this file.

import {
  accumulatedScreencastFrames,
  captureAndAttachVideo,
  finalizeScreencast,
  type AllureAttachSink,
  type TestOutcome,
  type TraceArtifact
} from '@wdio/devtools-core'
import type { ScreencastFrame } from '@wdio/devtools-shared'
import { ScreencastRecorder } from './screencast.js'
import type { SessionCapturer } from './session.js'
import type { ServiceOptions } from './types.js'

type LogFn = (level: 'info' | 'warn', message: string) => void

/** Live accessors into the owning service's state. The capturer is replaced in
 *  before() and the browser is replaced by reloadSession, so each is read
 *  lazily. */
export interface ScreencastLifecycleContext {
  options: ServiceOptions
  getBrowser: () => WebdriverIO.Browser | undefined
  getCapturer: () => SessionCapturer
  getOutputDir: () => string
  getTestUid: () => string | undefined
  getTestStartWallTime: () => number
  onArtifact: (artifact: TraceArtifact) => void
  log: LogFn
}

/** Per-test facts the video slice is keyed and retained on. */
export interface TestVideoInput {
  testUid: string | undefined
  attempt: number | undefined
  outcomes: TestOutcome[]
  attach: AllureAttachSink | undefined
}

export class ScreencastLifecycle {
  #ctx: ScreencastLifecycleContext
  #recorder?: ScreencastRecorder

  /** Recorder frames snapshotted in onReload before reloadSession replaces the
   *  recorder — so the ending test's per-test video can still be sliced in
   *  afterScenario (which runs AFTER the cucumber After hook's reloadSession). */
  #pendingVideoFrames?: {
    testUid: string | undefined
    startWallTime: number
    frames: ScreencastFrame[]
  }

  /** Filmstrip frames accumulated across reloadSession() boundaries — the
   *  recorder's buffer resets per session, so this persists earlier sessions'
   *  frames (like the action snapshots) and is concatenated with the live
   *  recorder's frames at export, then windowed per slice in core. */
  #filmstripFrames: ScreencastFrame[] = []

  constructor(ctx: ScreencastLifecycleContext) {
    this.#ctx = ctx
    if (ctx.options.mode === 'trace' && ctx.options.screencast?.enabled) {
      ctx.log(
        'warn',
        'trace mode: `screencast.enabled` is ignored — use `video` to record; ' +
          'the tuning fields (quality/interval) still apply'
      )
    }
  }

  /** Filmstrip defaults ON in trace mode; explicit `filmstrip: false` opts out. */
  #filmstripOn(): boolean {
    return this.#ctx.options.filmstrip ?? true
  }

  /** Record a screencast this session? Live mode: `screencast.enabled`. Trace
   *  mode: a non-`off` `video` policy (frames sliced per test at flush) or
   *  `filmstrip` (dense frames written into the trace itself). */
  #shouldRecord(): boolean {
    if (this.#ctx.options.mode === 'trace') {
      return (
        (!!this.#ctx.options.video && this.#ctx.options.video !== 'off') ||
        this.#filmstripOn()
      )
    }
    return !!this.#ctx.options.screencast?.enabled
  }

  /** Whole-run filmstrip frames for the export context: earlier sessions'
   *  accumulated frames plus the live recorder's, or undefined when filmstrip
   *  is off (so the trace stays byte-stable with today's output). */
  filmstripFramesForExport(): ScreencastFrame[] | undefined {
    if (!this.#filmstripOn()) {
      return undefined
    }
    return accumulatedScreencastFrames(this.#filmstripFrames, this.#recorder)
  }

  /**
   * Start recording on a freshly created session when enabled — `screencast.
   * enabled` in live mode, or a non-`off` `video` policy (per-test slicing at
   * flush) or `filmstrip` (dense frames into the trace) in trace mode. Failures
   * are non-fatal — logged by the recorder, session continues.
   */
  async start(browser: WebdriverIO.Browser): Promise<void> {
    if (!this.#shouldRecord()) {
      return
    }
    this.#recorder = new ScreencastRecorder(this.#ctx.options.screencast ?? {})
    await this.#recorder.start(browser)
  }

  /** On first URL navigation, mark the start of meaningful recording so leading
   *  blank frames (pre-test pauses, etc.) are trimmed from the video. */
  markStart(): void {
    this.#recorder?.setStartMarker()
  }

  /**
   * Called after browser.reloadSession(): the old session (and its CDP
   * connection) is already destroyed, so encode whatever frames it collected
   * and start a fresh recorder on the new session.
   */
  async handleReload(oldSessionId: string): Promise<void> {
    const browser = this.#ctx.getBrowser()
    if (!this.#shouldRecord() || !browser) {
      return
    }

    // Trace mode: the ending test's afterScenario runs AFTER this reload (a
    // cucumber `After(() => reloadSession())` is WDIO boilerplate), by which
    // point the recorder below has replaced these frames. Snapshot them now,
    // keyed to the ending test, so afterScenario can still slice its video.
    if (this.#ctx.options.mode === 'trace' && this.#recorder) {
      const frames = [...this.#recorder.frames]
      this.#pendingVideoFrames = {
        testUid: this.#ctx.getTestUid(),
        startWallTime: this.#ctx.getTestStartWallTime(),
        frames
      }
      // Persist for the filmstrip too — the recorder below resets the buffer,
      // so a session/spec trace spanning this reload keeps its earlier frames.
      if (this.#ctx.options.filmstrip) {
        this.#filmstripFrames.push(...frames)
      }
    }

    // Finalize the recording from the old session (CDP is already gone, so
    // stop() will fail gracefully and we encode whatever frames arrived).
    await this.finalize(oldSessionId)

    await this.start(browser)
  }

  /**
   * Stops the current recorder, encodes collected frames into a .webm file, and
   * notifies the backend. Safe to call even if recording never started or the
   * CDP session died early.
   */
  async finalize(sessionId: string): Promise<void> {
    if (!this.#recorder) {
      return
    }
    // Trace mode: the video is emitted per-test (sliced in attachTestVideo),
    // and there's no dashboard to receive a session recording — so just stop the
    // recorder to release resources; never encode an orphan session-wide webm.
    if (this.#ctx.options.mode === 'trace') {
      await this.#recorder.stop()
      return
    }
    // Skip ghost sessions: browser.reloadSession() creates a new session at
    // the end of a test run that has no steps — it captures at most a handful
    // of frames before teardown. Require at least 5 frames so we don't produce
    // empty videos for these ephemeral sessions.
    await finalizeScreencast({
      recorder: this.#recorder,
      sessionId,
      filenamePrefix: 'wdio-video',
      outputDir: this.#ctx.getOutputDir(),
      minFrames: 5,
      captureFormat: this.#ctx.options.screencast?.captureFormat,
      sendUpstream: (scope, data) =>
        this.#ctx.getCapturer().sendUpstream(scope, data),
      onLog: this.#ctx.log
    })
  }

  /** Slice the ending test's video out of the frame buffer and attach it per
   *  policy. Prefers frames snapshotted in handleReload (reloadSession tears the
   *  recorder down before the per-test hook runs); falls back to the live
   *  recorder otherwise. */
  async attachTestVideo(input: TestVideoInput): Promise<void> {
    const pending =
      this.#pendingVideoFrames?.testUid === input.testUid
        ? this.#pendingVideoFrames
        : undefined
    this.#pendingVideoFrames = undefined
    await captureAndAttachVideo({
      mode: this.#ctx.options.mode,
      granularity: this.#ctx.options.traceGranularity,
      policy: this.#ctx.options.video,
      frames: pending?.frames ?? this.#recorder?.frames,
      startWallTime: pending?.startWallTime ?? this.#ctx.getTestStartWallTime(),
      outcomes: input.outcomes,
      attempt: input.attempt,
      outputDir: this.#ctx.getOutputDir(),
      testUid: input.testUid,
      sessionId: this.#ctx.getBrowser()?.sessionId,
      captureFormat: this.#ctx.options.screencast?.captureFormat,
      attach: input.attach,
      onArtifact: this.#ctx.onArtifact,
      onLog: this.#ctx.log
    })
  }
}
