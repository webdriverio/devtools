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
  TestAttemptRecord,
  TestMetadataEntry,
  TestMetadataMap,
  TraceArtifact,
  TraceFormat
} from '@wdio/devtools-shared'
import { stepOwnerUid } from './uid.js'

/** Deterministic manifest filename for a session (used by writers and readers). */
export function artifactsManifestFilename(sessionId: string): string {
  return `devtools-artifacts-${sessionId}.json`
}

// Steps stay in testMetadata for the trace's step groups but are not test units; WDIO keys one off its scenario's uid, Selenium and Nightwatch nest it as a test under a scenario suite.
function isStepEntry(
  uid: string,
  meta: TestMetadataEntry,
  metadata: TestMetadataMap
): boolean {
  const owner = stepOwnerUid(uid)
  return (
    (owner !== undefined && metadata.has(owner)) ||
    meta.ancestry?.at(-1)?.kind === 'scenario'
  )
}

/** Stamps `final` on the attempt the test ended on, else on the last one recorded: the manifest reader rejects a list with no final record. */
function markFinalAttempt(
  attempts: TestAttemptRecord[],
  finalAttempt: number | undefined
): TestAttemptRecord[] {
  const final =
    attempts.find((record) => record.attempt === finalAttempt) ??
    attempts[attempts.length - 1]
  return attempts.map((record) =>
    record === final ? { ...record, final: true } : record
  )
}

/** Drops undefined values so an unset key is absent from the manifest, not present as undefined. */
function presentKeys<T extends Record<string, unknown>>(values: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== undefined)
  ) as Partial<T>
}

/** Assemble the manifest from the artifacts collected across the run and the
 *  test-metadata map. Pure — the write is separate so it stays unit-testable. */
export function buildArtifactsManifest(input: {
  sessionId: string
  format: TraceFormat
  artifacts: readonly TraceArtifact[]
  testMetadata: TestMetadataMap
  runId?: string
  parent?: ArtifactsManifest['parent']
  attemptsFor?: (uid: string) => TestAttemptRecord[]
  cwd?: string
  browserName?: string
  browserVersion?: string
  platformName?: string
}): ArtifactsManifest {
  const tests: ArtifactManifestTest[] = []
  for (const [uid, meta] of input.testMetadata) {
    if (isStepEntry(uid, meta, input.testMetadata)) {
      continue
    }
    const test: ArtifactManifestTest = {
      uid,
      title: meta.title,
      specFile: meta.specFile,
      state: meta.state,
      attempt: meta.attempt,
      startTime: meta.startTime,
      endTime: meta.endTime,
      durationMs: meta.durationMs,
      error: meta.error
    }
    const attempts = input.attemptsFor?.(uid)
    if (attempts && attempts.length > 0) {
      test.attempts = markFinalAttempt(attempts, meta.attempt)
    }
    tests.push(test)
  }
  return {
    sessionId: input.sessionId,
    format: input.format,
    artifacts: [...input.artifacts],
    tests,
    runId: input.runId,
    parent: input.parent,
    ...presentKeys({
      cwd: input.cwd,
      browserName: input.browserName,
      browserVersion: input.browserVersion,
      platformName: input.platformName
    })
  }
}

/** Artifact paths are stored relative to the manifest so the directory can move; a path on another Windows drive stays absolute. */
function relativizeArtifacts(
  outputDir: string,
  artifacts: readonly TraceArtifact[]
): TraceArtifact[] {
  return artifacts.map((artifact) => {
    if (artifact.path === '') {
      return artifact
    }
    const relative = path.relative(outputDir, artifact.path)
    if (path.isAbsolute(relative)) {
      return artifact
    }
    return { ...artifact, path: relative.split(path.sep).join('/') }
  })
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
  const portable = {
    ...manifest,
    artifacts: relativizeArtifacts(outputDir, manifest.artifacts)
  }
  await fs.writeFile(filePath, JSON.stringify(portable, null, 2), 'utf8')
  return filePath
}
