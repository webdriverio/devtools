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
import { ARTIFACTS_MANIFEST_VERSION } from '@wdio/devtools-shared'
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

/** Stamps `final` on the attempt the test ended on; the reader rejects a list with none. */
function markFinalAttempt(
  uid: string,
  attempts: TestAttemptRecord[],
  finalAttempt: number | undefined,
  warn: ((message: string) => void) | undefined
): TestAttemptRecord[] {
  const matching = attempts.find((record) => record.attempt === finalAttempt)
  if (matching === undefined && finalAttempt !== undefined) {
    const recorded = attempts.map((record) => record.attempt).join(', ')
    warn?.(
      `Test ${uid} ended on attempt ${finalAttempt}, which matches no recorded attempt (${recorded}); marking attempt ${attempts[attempts.length - 1]!.attempt} final.`
    )
  }
  const final = matching ?? attempts[attempts.length - 1]
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

/** A path relative to `base`, `/`-separated, or undefined when none exists (another Windows drive). */
function portableRelative(base: string, target: string): string | undefined {
  const relative = path.relative(base, target)
  return path.isAbsolute(relative)
    ? undefined
    : relative.split(path.sep).join('/')
}

/** A spec file under `specRoot` is written relative to it, anything else as is. */
function specFileFor(specFile: string, specRoot: string | undefined): string {
  // Metadata from adapters is not validated, so a spec file can still arrive unset.
  if (
    specRoot === undefined ||
    typeof specFile !== 'string' ||
    !path.isAbsolute(specFile)
  ) {
    return specFile
  }
  const relative = portableRelative(specRoot, specFile)
  if (relative === undefined || relative.split('/')[0] === '..') {
    return specFile
  }
  return relative
}

/** One test's manifest entry, with its attempts when any were recorded. */
function manifestTestOf(
  uid: string,
  meta: TestMetadataEntry,
  input: Pick<
    Parameters<typeof buildArtifactsManifest>[0],
    'attemptsFor' | 'specRoot' | 'warn'
  >
): ArtifactManifestTest {
  const test: ArtifactManifestTest = {
    uid,
    title: meta.title,
    specFile: specFileFor(meta.specFile, input.specRoot),
    state: meta.state,
    attempt: meta.attempt,
    startTime: meta.startTime,
    endTime: meta.endTime,
    durationMs: meta.durationMs,
    error: meta.error
  }
  const attempts = input.attemptsFor?.(uid) ?? []
  if (attempts.length === 0) {
    return test
  }
  return {
    ...test,
    attempts: markFinalAttempt(uid, attempts, meta.attempt, input.warn)
  }
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
  specRoot?: string
  warn?: (message: string) => void
  browserName?: string
  browserVersion?: string
  platformName?: string
}): ArtifactsManifest {
  const tests: ArtifactManifestTest[] = []
  for (const [uid, meta] of input.testMetadata) {
    if (!isStepEntry(uid, meta, input.testMetadata)) {
      tests.push(manifestTestOf(uid, meta, input))
    }
  }
  return {
    manifestVersion: ARTIFACTS_MANIFEST_VERSION,
    sessionId: input.sessionId,
    format: input.format,
    artifacts: [...input.artifacts],
    tests,
    runId: input.runId,
    parent: input.parent,
    ...presentKeys({
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
    const relative = portableRelative(outputDir, artifact.path)
    return relative === undefined ? artifact : { ...artifact, path: relative }
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
