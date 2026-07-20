// Per-test artifact emit (trace-slice attach + screenshot + video) for the
// Selenium plugin. Mirrors nightwatch's `test-artifacts.ts`, plus the two
// Selenium-only concerns: a live Allure attach sink (nightwatch is produce-only)
// and the just-flushed trace slice threaded through the input bag.
//
// Selenium's runner hooks fire-and-forget some emits (Gherkin `AfterStep`), so
// the mutable capture arrays are copied synchronously before the first await —
// the next test would otherwise overwrite their backing arrays mid-flight. Each
// core call self-gates on mode + `test` granularity + policy, so a non-trace run
// or a coarser granularity is a no-op.

import {
  attachTraceArtifact,
  captureAndAttachScreenshot,
  captureAndAttachVideo,
  lastRenderedScreenshot,
  resolveAdapterOutputDir,
  type AllureAttachSink,
  type TestOutcome,
  type TraceArtifact
} from '@wdio/devtools-core'
import { getAllureSink } from './allure.js'
import type {
  ActionSnapshot,
  DevToolsMode,
  ScreencastFrame,
  TestStats,
  TraceGranularity,
  TraceScreenshotPolicy,
  TraceVideoPolicy
} from './types.js'

export interface EmitTestArtifactsInput {
  mode: DevToolsMode
  granularity: TraceGranularity
  screenshotPolicy: TraceScreenshotPolicy
  videoPolicy: TraceVideoPolicy
  failed: boolean
  /** The just-flushed per-test trace slice, attached to Allure when present. */
  flushed: Promise<TraceArtifact | undefined>
  startWallTime: number
  sessionId: string | undefined
  /** Ended test — its `uid`/`retries` key the artifact and retry attempt. */
  endedTest: TestStats | null
  actionSnapshots: readonly ActionSnapshot[]
  frames: readonly ScreencastFrame[] | undefined
  /** This test's attempt slots (already scoped via `lastTestOutcomes`). */
  outcomes: readonly TestOutcome[]
  captureFormat?: 'jpeg' | 'png'
  testFilePath: string | undefined
  onArtifact: (artifact: TraceArtifact) => void
  onLog?: (level: 'info' | 'warn', message: string) => void
}

export class SeleniumTestArtifacts {
  /** Allure attach sink, resolved once lazily at the first per-test end
   *  (produce-only when Allure is inactive), reused across every attach. */
  #sinkResolved?: Promise<AllureAttachSink | undefined>

  #sink(): Promise<AllureAttachSink | undefined> {
    return (this.#sinkResolved ??= getAllureSink())
  }

  /** At a test/scenario end, while the runner's per-test hook is still open:
   *  attach the just-flushed trace slice to Allure, then capture + attach the
   *  per-test screenshot and video per their policies. */
  async emit(input: EmitTestArtifactsInput): Promise<void> {
    // Snapshot the mutable capture inputs synchronously before any await — see
    // the file header on Selenium's fire-and-forget hooks.
    const frames = input.frames ? [...input.frames] : undefined
    const outcomes = input.outcomes.map((o) => ({ ...o }))
    const screenshotBase64 = lastRenderedScreenshot(
      input.actionSnapshots,
      input.startWallTime
    )
    const outputDir = resolveAdapterOutputDir({
      testFilePath: input.testFilePath
    })
    const testUid = input.endedTest?.uid
    const { onArtifact, onLog } = input

    const attach = await this.#sink()
    const artifact = await input.flushed
    if (artifact) {
      await attachTraceArtifact(artifact, attach, onLog)
    }
    await captureAndAttachScreenshot({
      mode: input.mode,
      granularity: input.granularity,
      policy: input.screenshotPolicy,
      failed: input.failed,
      screenshotBase64,
      sessionId: input.sessionId,
      outputDir,
      testUid,
      attach,
      onArtifact,
      onLog
    })
    await captureAndAttachVideo({
      mode: input.mode,
      granularity: input.granularity,
      policy: input.videoPolicy,
      frames,
      startWallTime: input.startWallTime,
      outcomes,
      attempt: input.endedTest?.retries,
      outputDir,
      testUid,
      sessionId: input.sessionId,
      captureFormat: input.captureFormat,
      attach,
      onArtifact,
      onLog
    })
  }
}
