/**
 * The generic artifacts manifest: a single JSON side-file
 * (`devtools-artifacts-<sessionId>.json`) written next to the trace/video
 * artifacts at end-of-run. It enumerates every artifact a trace-mode session
 * produced — including the ones a retention policy decided against
 * (`retained: false`) — alongside each test's final state and attempt. Any
 * ecosystem reporter (Allure, a CI collector, a custom dashboard) can read this
 * one file to discover what to attach and how each test fared, instead of
 * re-deriving it from framework internals. The WDIO Allure glue consumes it
 * directly; Selenium/Nightwatch document reader recipes against it.
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import type {
  ArtifactManifestTest,
  ArtifactsManifest,
  TestMetadataMap,
  TraceArtifact,
  TraceFormat
} from '@wdio/devtools-shared'

export type { ArtifactManifestTest, ArtifactsManifest }

/** Deterministic manifest filename for a session (used by writers and readers). */
export function artifactsManifestFilename(sessionId: string): string {
  return `devtools-artifacts-${sessionId}.json`
}

/** Assemble the manifest from the artifacts collected across the run and the
 *  test-metadata map. Pure — the write is separate so it stays unit-testable. */
export function buildArtifactsManifest(input: {
  sessionId: string
  format: TraceFormat
  artifacts: readonly TraceArtifact[]
  testMetadata: TestMetadataMap
}): ArtifactsManifest {
  const tests: ArtifactManifestTest[] = []
  for (const [uid, meta] of input.testMetadata) {
    tests.push({
      uid,
      title: meta.title,
      specFile: meta.specFile,
      state: meta.state,
      attempt: meta.attempt,
      startTime: meta.startTime,
      endTime: meta.endTime,
      durationMs: meta.durationMs,
      error: meta.error
    })
  }
  return {
    sessionId: input.sessionId,
    format: input.format,
    artifacts: [...input.artifacts],
    tests
  }
}

/** Write the manifest to `outputDir`, returning its absolute path. */
export async function writeArtifactsManifest(
  outputDir: string,
  manifest: ArtifactsManifest
): Promise<string> {
  await fs.mkdir(outputDir, { recursive: true })
  const filePath = path.join(
    outputDir,
    artifactsManifestFilename(manifest.sessionId)
  )
  await fs.writeFile(filePath, JSON.stringify(manifest, null, 2), 'utf8')
  return filePath
}
