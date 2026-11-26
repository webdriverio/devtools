import { TraceFlags } from '@opentelemetry/api'
import type { Manifest } from './manifest.js'

export function runIdOf(
  file: string,
  manifest: Manifest,
  override: string | undefined,
  warn: (message: string) => void
): string {
  if (override !== undefined) {
    return override
  }
  if (manifest.runId !== undefined) {
    return manifest.runId
  }
  warn(
    `${file} has no runId, so its run is named by its sessionId ${manifest.sessionId}; pass --run-id to group it with other manifests`
  )
  return manifest.sessionId
}

/** Unsampled spans would be dropped by the SDK anyway; saying so names the manifest and the flag that pushes it. */
export function unsampledParent(
  file: string,
  manifest: Manifest,
  warn: (message: string) => void
): boolean {
  const flags = manifest.parent?.traceFlags
  if (flags === undefined || (flags & TraceFlags.SAMPLED) !== 0) {
    return false
  }
  warn(
    `${file} was recorded under an unsampled TRACEPARENT, so its ${manifest.tests.length} test(s) were not pushed; pass --ignore-parent-sampling to push them anyway`
  )
  return true
}
