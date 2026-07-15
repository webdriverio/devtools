// Per-test failure/always screenshot for the WDIO adapter: the policy gate and
// the Allure attach. Kept out of index.ts so the god-file stays lean and the
// capture is unit-testable. The policy decision and file write live in core
// (framework-agnostic).
//
// The image is NOT a fresh screenshot taken here — it's the last rendered action
// snapshot the service already captured during the test. A fresh end-of-test
// takeScreenshot() is unreliable: a cucumber `After(() => reloadSession())` hook
// (WDIO boilerplate) runs before the service afterScenario hook and blanks the
// page, so an end-of-test capture comes back empty. The last action snapshot was
// captured mid-command, before any teardown, so it's the real failure-moment
// frame — and reusing it also drops an extra WebDriver command from the report.

import {
  shouldCaptureScreenshot,
  writeScreenshotArtifact,
  type TraceArtifact
} from '@wdio/devtools-core'
import type {
  DevToolsMode,
  TraceGranularity,
  TraceScreenshotPolicy
} from '@wdio/devtools-shared'
import { attachArtifactToAllure } from './allure.js'

/**
 * Write the per-test screenshot (per the policy) from an already-captured base64
 * frame and attach it to Allure. No-op outside `test`-granularity trace mode,
 * without a uid/session/frame, or when the policy declines. Gated to `test`
 * granularity so the whole per-test inline story (trace + screenshot + video) is
 * one rule; coarser granularities keep their artifacts in the manifest. The
 * artifact is handed to `onArtifact` so it lands in the manifest too.
 */
export async function captureAndAttachScreenshot(input: {
  mode: DevToolsMode | undefined
  granularity: TraceGranularity | undefined
  policy: TraceScreenshotPolicy | undefined
  failed: boolean
  /** Base64 of the last rendered action snapshot (reload-immune, not a fresh
   *  end-of-test capture). Undefined when the test recorded no snapshot. */
  screenshotBase64: string | undefined
  sessionId: string | undefined
  outputDir: string
  testUid: string | undefined
  onArtifact: (artifact: TraceArtifact) => void
}): Promise<void> {
  const { mode, granularity, policy, failed, screenshotBase64, sessionId } =
    input
  if (
    mode !== 'trace' ||
    granularity !== 'test' ||
    !screenshotBase64 ||
    !sessionId ||
    !input.testUid ||
    !shouldCaptureScreenshot(policy, failed)
  ) {
    return
  }
  const artifact = await writeScreenshotArtifact({
    outputDir: input.outputDir,
    testUid: input.testUid,
    sessionId,
    base64: screenshotBase64
  })
  input.onArtifact(artifact)
  await attachArtifactToAllure(artifact)
}
