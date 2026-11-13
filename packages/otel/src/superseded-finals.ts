import { browserScopeOf, type Manifest, type ManifestTest } from './manifest.js'
import { STATE_FAILED } from './prepared.js'

export interface RunManifest {
  manifest: Manifest
  mtimeMs: number
  runId: string
}

interface FinalOutcome {
  test: ManifestTest
  scope: string
  state: string | undefined
  startMs: number
  endMs: number
}

function finalOutcomeOf(
  test: ManifestTest,
  mtimeMs: number,
  scope: string
): FinalOutcome {
  const record = test.attempts?.find((candidate) => candidate.final)
  const startMs = record?.startTime ?? test.startTime ?? mtimeMs
  return {
    test,
    scope,
    state: test.state,
    startMs,
    endMs: record?.endTime ?? test.endTime ?? startMs
  }
}

// A failed final that a later final of the same browser in the same run started after is a retried attempt; overlapping finals are siblings.
export function supersededFinals(
  manifests: readonly RunManifest[]
): (test: ManifestTest) => boolean {
  const byTest = new Map<string, FinalOutcome[]>()
  for (const { manifest, mtimeMs, runId } of manifests) {
    const scope = browserScopeOf(manifest)
    for (const test of manifest.tests) {
      const key = JSON.stringify([runId, test.uid])
      const finals = byTest.get(key) ?? []
      finals.push(finalOutcomeOf(test, mtimeMs, scope))
      byTest.set(key, finals)
    }
  }
  const superseded = new Set<ManifestTest>()
  for (const finals of byTest.values()) {
    for (const earlier of finals) {
      if (
        earlier.state === STATE_FAILED &&
        finals.some(
          (later) =>
            later !== earlier &&
            later.scope === earlier.scope &&
            later.startMs >= earlier.endMs
        )
      ) {
        superseded.add(earlier.test)
      }
    }
  }
  return (test) => superseded.has(test)
}
