import path from 'node:path'
import { retryKeyOf } from '@wdio/devtools-shared'
import type {
  ParsedManifest,
  ParsedManifestArtifact,
  ParsedManifestTest
} from './artifacts-manifest-reader.js'

const RETRY_DIR_SUFFIX = /-retry(\d+)$/

function retryOf(artifact: ParsedManifestArtifact): number {
  const dir = path.basename(path.dirname(artifact.path))
  return Number(RETRY_DIR_SUFFIX.exec(dir)?.[1] ?? 0)
}

/** A session or spec zip is flat and holds every attempt of its tests; only a per-test zip's folder names an attempt. */
function coversEveryAttempt(artifact: ParsedManifestArtifact): boolean {
  const dir = path.basename(path.dirname(artifact.path))
  return (
    (artifact.scope === 'session' || artifact.scope === 'spec') &&
    !RETRY_DIR_SUFFIX.test(dir)
  )
}

/** The attempt that decided the test: its final record's, or `test.attempt` when the manifest has no `attempts`. */
function finalAttemptOf(test: ParsedManifestTest): number {
  return test.attempts?.find((record) => record.final)?.attempt ?? test.attempt
}

/** Whether the test's zip also holds the actions of an earlier attempt, so reading it would attach them to the final one. */
export function holdsEarlierAttempts(
  artifact: ParsedManifestArtifact,
  test: ParsedManifestTest
): boolean {
  return coversEveryAttempt(artifact) && finalAttemptOf(test) > 0
}

/** The zip of the test's final attempt; an earlier attempt's zip never stands in for it. */
function pickTraceArtifact(
  candidates: ParsedManifestArtifact[],
  test: ParsedManifestTest
): ParsedManifestArtifact | undefined {
  // A spec-scope zip is keyed by its spec file, so only a per-test key (uid or uid-retryN) selects an exact attempt.
  if (
    candidates.some(
      (artifact) => artifact.key?.replace(RETRY_DIR_SUFFIX, '') === test.uid
    )
  ) {
    const key = retryKeyOf(test.uid, finalAttemptOf(test))
    return candidates.find((artifact) => artifact.key === key)
  }
  const attempt = finalAttemptOf(test)
  return (
    candidates.find(
      (artifact) =>
        !coversEveryAttempt(artifact) && retryOf(artifact) === attempt
    ) ?? candidates.find(coversEveryAttempt)
  )
}

/** Each test's final-attempt trace zip, keyed by uid; built once per manifest. */
export function traceArtifactsByUid(
  manifest: ParsedManifest
): Map<string, ParsedManifestArtifact> {
  const candidates = new Map<string, ParsedManifestArtifact[]>()
  for (const artifact of manifest.artifacts) {
    if (artifact.kind !== 'trace') {
      continue
    }
    for (const uid of artifact.testUids) {
      const list = candidates.get(uid) ?? []
      list.push(artifact)
      candidates.set(uid, list)
    }
  }
  const byUid = new Map<string, ParsedManifestArtifact>()
  for (const test of manifest.tests) {
    const artifact = pickTraceArtifact(candidates.get(test.uid) ?? [], test)
    if (artifact) {
      byUid.set(test.uid, artifact)
    }
  }
  return byUid
}
