// Per-test video for the WDIO adapter: the granularity/policy gate, the
// retention decision, the frame-window slice, the encode, and the Allure
// attach. Kept out of index.ts so the god-file stays lean. The slice + encode
// live in core (framework-agnostic); only the recorder is WDIO-specific.

import {
  encodePerTestVideo,
  shouldRetainTrace,
  sliceFramesFrom,
  type TestOutcome,
  type TraceArtifact
} from '@wdio/devtools-core'
import type {
  DevToolsMode,
  ScreencastFrame,
  TraceGranularity,
  TraceVideoPolicy
} from '@wdio/devtools-shared'
import { attachArtifactToAllure } from './allure.js'

/**
 * Slice the continuous screencast to this test's window, encode a `.webm`, and
 * attach it to Allure — when trace mode + `test` granularity + a non-`off`
 * `video` policy that retains this test's outcome. No-op otherwise. The encoded
 * artifact is handed to `onArtifact` so it lands in the manifest.
 */
export async function captureAndAttachVideo(input: {
  mode: DevToolsMode | undefined
  granularity: TraceGranularity | undefined
  policy: TraceVideoPolicy | undefined
  frames: readonly ScreencastFrame[] | undefined
  startWallTime: number
  outcomes: TestOutcome[]
  attempt: number | undefined
  outputDir: string
  testUid: string | undefined
  sessionId: string | undefined
  captureFormat?: 'jpeg' | 'png'
  onArtifact: (artifact: TraceArtifact) => void
  onLog?: (level: 'info' | 'warn', message: string) => void
}): Promise<void> {
  const { mode, granularity, policy, frames, testUid, sessionId } = input
  if (
    mode !== 'trace' ||
    granularity !== 'test' ||
    !policy ||
    policy === 'off' ||
    !frames ||
    !testUid ||
    !sessionId ||
    // No recorded attempt for this uid — the test never started (e.g. a
    // skipped/pending test whose afterTest fires without a beforeTest). Skip
    // rather than fail-open on empty outcomes, which would slice the PREVIOUS
    // test's frames into a video attributed to this one.
    input.outcomes.length === 0
  ) {
    return
  }
  const decision = shouldRetainTrace(policy, {
    outcomes: input.outcomes,
    attemptInfoAvailable: true
  })
  if (!decision.retain) {
    return
  }
  const artifact = await encodePerTestVideo({
    frames: sliceFramesFrom(frames, input.startWallTime),
    outputDir: input.outputDir,
    testUid,
    sessionId,
    attempt: input.attempt,
    captureFormat: input.captureFormat,
    onLog: input.onLog
  })
  if (!artifact) {
    return
  }
  input.onArtifact(artifact)
  await attachArtifactToAllure(artifact)
}
