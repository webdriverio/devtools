import type {
  CommandLog,
  DocumentInfo,
  PerformanceData
} from '@wdio/devtools-shared'

/**
 * JS source that captures Performance API data, cookies, and document info
 * from the page under test. Passed as a string to the adapter's `execute`/
 * `executeScript` driver method so the browser-only types (PerformanceEntry,
 * Document) don't leak into the Node-side type-checker.
 *
 * Returns the bag shape consumed by {@link applyPerformanceData}.
 * Framework-agnostic — all three adapters can use it.
 */
export const CAPTURE_PERFORMANCE_SCRIPT = `
  (function() {
    const performance = window.performance;
    const navigation = performance.getEntriesByType?.('navigation')?.[0];
    const resources = performance.getEntriesByType?.('resource') || [];

    return {
      navigation: navigation ? {
        url: window.location.href,
        timing: {
          loadTime: navigation.loadEventEnd - navigation.fetchStart,
          domReady: navigation.domContentLoadedEventEnd - navigation.fetchStart,
          responseTime: navigation.responseEnd - navigation.requestStart,
          dnsLookup: navigation.domainLookupEnd - navigation.domainLookupStart,
          tcpConnection: navigation.connectEnd - navigation.connectStart,
          serverResponse: navigation.responseEnd - navigation.responseStart
        }
      } : undefined,
      resources: resources.map(function(resource) {
        return {
          url: resource.name,
          duration: resource.duration,
          size: resource.transferSize || 0,
          type: resource.initiatorType,
          startTime: resource.startTime,
          responseEnd: resource.responseEnd
        };
      }),
      cookies: (function() {
        try { return document.cookie; } catch (e) { return ''; }
      })(),
      documentInfo: {
        url: window.location.href,
        title: document.title,
        headers: {
          userAgent: navigator.userAgent,
          language: navigator.language,
          platform: navigator.platform
        },
        documentInfo: {
          readyState: document.readyState,
          referrer: document.referrer,
          characterSet: document.characterSet
        }
      }
    };
  })()
`

/** Untyped bag returned by {@link CAPTURE_PERFORMANCE_SCRIPT}. */
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
    loadTime: payload.navigation?.timing?.loadTime,
    resources: payload.resources,
    resourceCount: payload.resources?.length,
    cookies: payload.cookies,
    title: payload.documentInfo?.title
  }
  return true
}
