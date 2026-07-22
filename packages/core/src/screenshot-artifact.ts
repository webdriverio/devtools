/**
 * Per-test screenshot artifact: the policy decision and the file write, kept
 * framework-agnostic so every adapter feeds it the same way (the adapter only
 * supplies the base64 capture from its own driver). Mirrors Playwright's
 * `screenshot` option — `on` after every test, `only-on-failure` after a
 * failing one — and produces a TraceArtifact the manifest and the Allure glue
 * consume like any other artifact.
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import type { TraceScreenshotPolicy } from '@wdio/devtools-shared'
import { fileSlug } from './artifact-naming.js'
import type { TraceArtifact } from './trace-finalizer.js'

/** Whether a per-test screenshot should be captured for this outcome. */
export function shouldCaptureScreenshot(
  policy: TraceScreenshotPolicy | undefined,
  failed: boolean
): boolean {
  if (policy === 'on') {
    return true
  }
  if (policy === 'only-on-failure') {
    return failed
  }
  return false
}

/**
 * Write a base64 PNG (from the driver's screenshot command) next to the trace
 * output and return the artifact describing it. Retained is always true — a
 * screenshot is only ever written when the policy already decided to capture.
 */
export async function writeScreenshotArtifact(input: {
  outputDir: string
  testUid: string
  sessionId: string
  base64: string
}): Promise<TraceArtifact> {
  await fs.mkdir(input.outputDir, { recursive: true })
  const filename = `screenshot-${fileSlug(input.testUid)}-${input.sessionId.slice(0, 8)}.png`
  const filePath = path.join(input.outputDir, filename)
  await fs.writeFile(filePath, Buffer.from(input.base64, 'base64'))
  return {
    kind: 'screenshot',
    path: filePath,
    scope: 'test',
    key: input.testUid,
    testUids: [input.testUid],
    retained: true
  }
}
