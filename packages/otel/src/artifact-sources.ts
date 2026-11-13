import path from 'node:path'
import { parseTraceZip } from '@wdio/devtools-trace/trace-reader'
import { retryKeyOf, type TracePlayerData } from '@wdio/devtools-shared'
import type { ManifestArtifact, Manifest, ManifestTest } from './manifest.js'

const RETRY_DIR_SUFFIX = /-retry(\d+)$/

export function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function retryOf(artifact: ManifestArtifact): number {
  const dir = path.basename(path.dirname(artifact.path))
  return Number(RETRY_DIR_SUFFIX.exec(dir)?.[1] ?? 0)
}

/** A session or spec zip is flat and holds every attempt of its tests; only a per-test zip's folder names an attempt. */
export function coversEveryAttempt(artifact: ManifestArtifact): boolean {
  const dir = path.basename(path.dirname(artifact.path))
  return (
    (artifact.scope === 'session' || artifact.scope === 'spec') &&
    !RETRY_DIR_SUFFIX.test(dir)
  )
}

/** Whether the test's zip also holds the actions of an earlier attempt, so reading it would attach them to the final one. */
export function holdsEarlierAttempts(
  artifact: ManifestArtifact,
  test: ManifestTest
): boolean {
  return coversEveryAttempt(artifact) && finalAttemptOf(test) > 0
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
  return (
    candidates.find(
      (artifact) =>
        !coversEveryAttempt(artifact) && retryOf(artifact) === attempt
    ) ?? candidates.find(coversEveryAttempt)
  )
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

/** The path of `file` under `dir`, or undefined when it is `dir` itself or resolves outside it. */
export function relativeWithin(dir: string, file: string): string | undefined {
  const relative = path.relative(dir, file)
  return relative === '' ||
    path.isAbsolute(relative) ||
    relative.split(path.sep).includes('..')
    ? undefined
    : relative
}

export function artifactUrlFor(
  dir: string,
  zipPath: string,
  base: string,
  warn: (message: string) => void
): string | undefined {
  const relative = relativeWithin(dir, zipPath)
  if (relative === undefined) {
    warn(
      `no artifact URL for ${zipPath}: the zip is outside the manifest directory ${dir}, so it cannot be addressed under --artifact-base-url`
    )
    return undefined
  }
  return new URL(
    relative.split(path.sep).map(encodeURIComponent).join('/'),
    withTrailingSlash(base)
  ).href
}

interface ZipReader {
  read: (zipPath: string, dir: string) => TracePlayerData | undefined
  unreadable: () => string[]
}

interface ZipReaderInput {
  loadZip: (zipPath: string) => Uint8Array
  realpath: (target: string) => string
  warn: (message: string) => void
}

// A symlink in the manifest folder can point outside it, so the real paths are compared too; a missing zip throws here.
function containedRealPath(
  dir: string,
  zipPath: string,
  realpath: (target: string) => string
): string | undefined {
  if (relativeWithin(dir, zipPath) === undefined) {
    return undefined
  }
  const real = realpath(zipPath)
  return relativeWithin(realpath(dir), real) === undefined ? undefined : real
}

/** An unreadable zip, or one outside `dir`, warns and is listed by `unreadable()`; its test's actions are skipped. */
export function zipReader({
  loadZip,
  realpath,
  warn
}: ZipReaderInput): ZipReader {
  const failed = new Set<string>()
  return {
    read(zipPath, dir) {
      try {
        const real = containedRealPath(dir, zipPath, realpath)
        if (real === undefined) {
          warn(
            `skipped the actions in ${zipPath}: the zip is outside the manifest directory ${dir}, so it is not read`
          )
          failed.add(zipPath)
          return undefined
        }
        return parseTraceZip(loadZip(real))
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
