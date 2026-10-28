import type {
  CommandLog,
  DocumentInfo,
  PerformanceData
} from '@wdio/devtools-shared'

export { CAPTURE_PERFORMANCE_SCRIPT } from '@wdio/devtools-shared/page-scripts'

/** Untyped bag returned by shared's `CAPTURE_PERFORMANCE_SCRIPT`. */
export interface CapturedPerformancePayload {
  navigation?: PerformanceData['navigation']
  resources?: PerformanceData['resources']
  cookies?: string
  documentInfo?: DocumentInfo
}

/**
 * Apply a captured performance payload onto a CommandLog entry in-place,
 * setting `performance`, `cookies`, `documentInfo`, and a synthesized `result`
 * matching nightwatch's existing dashboard shape. Returns `true` if anything
 * was applied — caller can branch on this to skip further work.
 */
/** A duration for the row's summary: the Performance API reports milliseconds at sub-microsecond precision, which reads as noise. */
export function formatMilliseconds(ms: number | undefined): string | undefined {
  return typeof ms === 'number' && Number.isFinite(ms)
    ? `${ms.toFixed(2)} ms`
    : undefined
}

export function applyPerformanceData(
  command: CommandLog,
  payload: CapturedPerformancePayload | undefined,
  navigatedUrl?: string
): boolean {
  if (!payload || !payload.navigation) {
    return false
  }
  command.performance = {
    navigation: payload.navigation,
    resources: payload.resources
  }
  command.cookies = payload.cookies
  command.documentInfo = payload.documentInfo
  command.result = {
    url: navigatedUrl,
    loadTime: formatMilliseconds(payload.navigation?.timing?.loadTime),
    resources: payload.resources,
    resourceCount: payload.resources?.length,
    cookies: payload.cookies,
    title: payload.documentInfo?.title
  }
  return true
}
