// Framework-agnostic capture-and-attach of per-test trace artifacts to Allure.
// The *produce* half (screenshot/video write, retention decision) already lives
// in core; this module adds the orchestration + the attach, behind a pluggable
// `AllureAttachSink` so each adapter supplies only its reporter binding:
//   - WDIO service → @wdio/allure-reporter's addAttachment
//   - Selenium     → allure-js-commons' attachment() (runtime-agnostic)
//   - Nightwatch   → no sink (produce-only; its Allure path is post-hoc, with no
//                    live attach API), so artifacts land in the manifest only.
// A missing/undefined sink means "produce but don't attach" — never an error.

import fs from 'node:fs/promises'
import { basename } from 'node:path'
import type {
  ActionSnapshot,
  DevToolsMode,
  ScreencastFrame,
  TraceGranularity,
  TraceScreenshotPolicy,
  TraceVideoPolicy
} from '@wdio/devtools-shared'
import {
  shouldCaptureScreenshot,
  writeScreenshotArtifact
} from './screenshot-artifact.js'
import { encodePerTestVideo, sliceFramesFrom } from './video-slice.js'
import { shouldRetainTrace, type TestOutcome } from './trace-retention.js'
import type { TraceArtifact } from './trace-finalizer.js'

/** Adapter-supplied binding to the active Allure reporter. Attaches one file to
 *  the currently-executing test. Undefined = attach unsupported (produce-only). */
export type AllureAttachSink = (
  name: string,
  content: Buffer,
  contentType: string
) => void | Promise<void>

type LogFn = (level: 'info' | 'warn', message: string) => void

// Trace stays a plain zip download (the viewer is the user's choice, not a
// third-party viewer Allure would open for a trace-specific content type);
// video/image render inline.
const CONTENT_TYPE_BY_KIND: Record<TraceArtifact['kind'], string> = {
  trace: 'application/zip',
  video: 'video/webm',
  screenshot: 'image/png'
}

/**
 * Read a retained artifact and hand it to the sink for attachment to the current
 * Allure test. No-op when the artifact wasn't retained, has no path, the sink is
 * absent, or the path is a directory (the ndjson-directory trace format). Never
 * throws — a missing/unreadable artifact must not reject the caller's hook.
 */
export async function attachTraceArtifact(
  artifact: TraceArtifact,
  sink: AllureAttachSink | undefined,
  onLog?: LogFn
): Promise<void> {
  if (!sink || !artifact.retained || !artifact.path) {
    return
  }
  try {
    const stat = await fs.stat(artifact.path)
    if (!stat.isFile()) {
      return
    }
    const content = await fs.readFile(artifact.path)
    await sink(
      basename(artifact.path),
      content,
      CONTENT_TYPE_BY_KIND[artifact.kind]
    )
  } catch (err) {
    onLog?.(
      'warn',
      `Allure attach skipped for ${artifact.path}: ${String(err)}`
    )
  }
}

/**
 * The base64 of the last rendered action snapshot for the current test, skipping
 * the end-of-scenario `__final__` frame (captured post-teardown, often blank when
 * a reloadSession runs before the after-hook). Scoped to `>= startWallTime` so a
 * test that captured nothing doesn't borrow the previous test's frame. Reused as
 * the per-test screenshot — reload-immune and one fewer WebDriver command than a
 * fresh end-of-test capture.
 */
export function lastRenderedScreenshot(
  snapshots: readonly ActionSnapshot[],
  startWallTime: number
): string | undefined {
  for (let i = snapshots.length - 1; i >= 0; i--) {
    const snap = snapshots[i]!
    if (snap.timestamp < startWallTime) {
      return undefined
    }
    if (snap.command !== '__final__' && snap.screenshot) {
      return snap.screenshot
    }
  }
  return undefined
}

/**
 * Write the per-test screenshot (per policy) from an already-captured base64
 * frame, record it in the manifest, and attach it via the sink. No-op outside
 * `test`-granularity trace mode, without a uid/session/frame, or when the policy
 * declines. Gated to `test` granularity so the whole per-test inline story
 * (trace + screenshot + video) is one rule.
 */
export async function captureAndAttachScreenshot(input: {
  mode: DevToolsMode | undefined
  granularity: TraceGranularity | undefined
  policy: TraceScreenshotPolicy | undefined
  failed: boolean
  /** Base64 of the last rendered action snapshot (reload-immune). */
  screenshotBase64: string | undefined
  sessionId: string | undefined
  outputDir: string
  testUid: string | undefined
  attach: AllureAttachSink | undefined
  onArtifact: (artifact: TraceArtifact) => void
  onLog?: LogFn
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
  await attachTraceArtifact(artifact, input.attach, input.onLog)
}

/**
 * Slice the continuous screencast to this test's window, encode a `.webm`,
 * record it in the manifest, and attach it via the sink — when trace mode +
 * `test` granularity + a non-`off` `video` policy retains this test's outcome.
 * Empty outcomes (test never started) skip rather than fail-open onto the
 * previous test's frames.
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
  attach: AllureAttachSink | undefined
  onArtifact: (artifact: TraceArtifact) => void
  onLog?: LogFn
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
    input.outcomes.length === 0
  ) {
    return
  }
  if (
    !shouldRetainTrace(policy, {
      outcomes: input.outcomes,
      attemptInfoAvailable: true
    }).retain
  ) {
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
  await attachTraceArtifact(artifact, input.attach, input.onLog)
}
