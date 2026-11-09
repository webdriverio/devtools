import path from 'node:path'
import { parseTraceZip } from '@wdio/devtools-trace/trace-reader'
import { retryKeyOf, type TracePlayerData } from '@wdio/devtools-shared'
import type { ManifestArtifact, Manifest, ManifestTest } from './manifest.js'

// Keyless artifacts (session-scope zips, manifests from before `key`) name their attempt only in the folder; a per-test key ends the same way.
const RETRY_DIR_SUFFIX = /-retry(\d+)$/

export function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function retryOf(artifact: ManifestArtifact): number {
  const dir = path.basename(path.dirname(artifact.path))
  return Number(RETRY_DIR_SUFFIX.exec(dir)?.[1] ?? 0)
}

/** The attempt the test's trace root is linked under: its final record's, or `test.attempt` when the manifest has no `attempts`. */
function finalAttemptOf(test: ManifestTest): number {
  return test.attempts?.find((record) => record.final)?.attempt ?? test.attempt
}

/** The zip of the test's final attempt; an earlier attempt's zip never stands in for it. */
function pickTraceArtifact(
  candidates: ManifestArtifact[],
  test: ManifestTest
): ManifestArtifact | undefined {
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
  return candidates.find((artifact) => retryOf(artifact) === attempt)
}

/** Each test's final-attempt trace zip, keyed by uid; built once per manifest. */
export function traceArtifactsByUid(
  manifest: Manifest
): Map<string, ManifestArtifact> {
  const candidates = new Map<string, ManifestArtifact[]>()
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
  const byUid = new Map<string, ManifestArtifact>()
  for (const test of manifest.tests) {
    const artifact = pickTraceArtifact(candidates.get(test.uid) ?? [], test)
    if (artifact) {
      byUid.set(test.uid, artifact)
    }
  }
  return byUid
}

function withTrailingSlash(url: string): string {
  return url.endsWith('/') ? url : `${url}/`
}

export function artifactUrlFor(
  dir: string,
  zipPath: string,
  base: string,
  warn: (message: string) => void
): string | undefined {
  const relative = path.relative(dir, zipPath)
  const segments = relative.split(path.sep)
  if (path.isAbsolute(relative) || segments.includes('..')) {
    warn(
      `no artifact URL for ${zipPath}: the zip is outside the manifest directory ${dir}, so it cannot be addressed under --artifact-base-url`
    )
    return undefined
  }
  return new URL(
    segments.map(encodeURIComponent).join('/'),
    withTrailingSlash(base)
  ).href
}

interface ZipReader {
  read: (zipPath: string) => TracePlayerData | undefined
  unreadable: () => string[]
}

/** An unreadable zip warns and its test's actions are skipped; it is listed by `unreadable()`. */
export function zipReader(
  loadZip: (zipPath: string) => Uint8Array,
  warn: (message: string) => void
): ZipReader {
  const failed = new Set<string>()
  return {
    read(zipPath) {
      try {
        return parseTraceZip(loadZip(zipPath))
      } catch (error) {
        warn(
          `skipped the actions in ${zipPath}, which could not be read: ${describe(error)}`
        )
        failed.add(zipPath)
        return undefined
      }
    },
    unreadable: () => [...failed]
  }
}
