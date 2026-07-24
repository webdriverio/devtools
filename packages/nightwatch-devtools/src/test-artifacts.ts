/**
 * Produce-only per-test artifacts (screenshot + video) for the Nightwatch
 * plugin.
 *
 * Nightwatch has no live Allure attach API — its official `nightwatch-allure`
 * reporter is post-hoc, and `allure-js-commons`' `attachment()` no-ops in a
 * Nightwatch run (nothing wires the global test runtime). So we pass NO sink
 * (`attach: undefined`), which the core treats as produce-only: it writes the
 * file and records the manifest artifact via `onArtifact`, but skips the attach.
 *
 * Both the per-test (Mocha/Jasmine `afterEach`) and cucumber (per-scenario
 * finalize) paths funnel through here so the two produce calls live once. Core
 * gates both to trace mode + `test` granularity, so this no-ops otherwise.
 */

import {
  captureAndAttachScreenshot,
  captureAndAttachVideo,
  lastRenderedScreenshot,
  type TestOutcome,
  type TraceArtifact
} from '@wdio/devtools-core'
import type {
  ActionSnapshot,
  DevToolsMode,
  ScreencastFrame,
  TraceGranularity,
  TraceScreenshotPolicy,
  TraceVideoPolicy
} from '@wdio/devtools-shared'

export interface EmitTestArtifactsInput {
  mode: DevToolsMode
  granularity: TraceGranularity
  screenshotPolicy: TraceScreenshotPolicy
  videoPolicy: TraceVideoPolicy
  failed: boolean
  actionSnapshots: readonly ActionSnapshot[]
  frames: readonly ScreencastFrame[]
  startWallTime: number
  /** This test's attempt slots (already scoped via `forTest`) for retention. */
  outcomes: TestOutcome[]
  uid: string | undefined
  attempt: number | undefined
  sessionId: string | undefined
  outputDir: string
  captureFormat?: 'jpeg' | 'png'
  onArtifact: (artifact: TraceArtifact) => void
  onLog?: (level: 'info' | 'warn', message: string) => void
}

/**
 * Produce this test's screenshot then its video slice, both with `attach:
 * undefined` (produce-only). Each core call self-gates on mode/granularity/
 * policy, so a non-trace run or a non-`test` granularity is a no-op.
 */
export async function emitTestArtifacts(
  input: EmitTestArtifactsInput
): Promise<void> {
  await captureAndAttachScreenshot({
    mode: input.mode,
    granularity: input.granularity,
    policy: input.screenshotPolicy,
    failed: input.failed,
    screenshotBase64: lastRenderedScreenshot(
      input.actionSnapshots,
      input.startWallTime
    ),
    sessionId: input.sessionId,
    outputDir: input.outputDir,
    testUid: input.uid,
    attach: undefined,
    onArtifact: input.onArtifact,
    onLog: input.onLog
  })
  await captureAndAttachVideo({
    mode: input.mode,
    granularity: input.granularity,
    policy: input.videoPolicy,
    frames: input.frames,
    startWallTime: input.startWallTime,
    outcomes: input.outcomes,
    attempt: input.attempt,
    outputDir: input.outputDir,
    testUid: input.uid,
    sessionId: input.sessionId,
    captureFormat: input.captureFormat,
    attach: undefined,
    onArtifact: input.onArtifact,
    onLog: input.onLog
  })
}
