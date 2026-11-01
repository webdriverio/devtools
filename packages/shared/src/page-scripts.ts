/**
 * Page-side scripts every adapter runs against the collector and the page's
 * Performance API: the readiness probe, the `<script>` injection, the drain and
 * the navigation timing read.
 *
 * Page code with no Node dependency, so it lives here rather than in core, and
 * the backend serves it for the adapter that cannot import this package. A
 * copy per language drifted: the JS performance script lacked the outer
 * `return` the Python copy had, so no JS adapter attached load timings to a
 * navigation row.
 */

/**
 * HTTP contract for {@link PageScriptsResponse}.
 *
 * Its own route rather than a field of `ELEMENT_SCRIPTS_API`: those are
 * generated per runner for the A11y tab and fetched only when it is on, while
 * these are static and every run needs them for DOM replay and navigation
 * timings. One envelope would make every caller pass a runner it does not use
 * and tie the collector's lifecycle to an optional feature.
 */
export const PAGE_SCRIPTS_API = {
  get: '/api/page-scripts'
} as const

/** `Content-Type` for {@link PAGE_SCRIPTS_API}: a JSON envelope, since a
 *  caller needs all four scripts. */
export const PAGE_SCRIPTS_CONTENT_TYPE = 'application/json; charset=utf-8'

/** Browser-side expression that is true once the injected collector has
 *  initialised, so the collector's global name lives in one place. */
export const COLLECTOR_READY_EXPRESSION =
  'typeof window.wdioTraceCollector !== "undefined"'

/** Script body answering {@link COLLECTOR_READY_EXPRESSION}. */
export const COLLECTOR_READY_SCRIPT = `return ${COLLECTOR_READY_EXPRESSION};`

/** Appends a `<script>` whose body is `arguments[0]` (the collector wrapped for
 *  a script element) and answers whether the collector came up; an appended
 *  script runs synchronously, so it usually has. */
export const COLLECTOR_INJECT_SCRIPT = `var s=document.createElement('script');s.textContent=arguments[0];document.head.appendChild(s);${COLLECTOR_READY_SCRIPT}`

/**
 * Script body that drains the collector in one round trip, atomic against a
 * navigation replacing the document mid-check.
 *
 * `forceAnchor` forces a full-DOM anchor of the CURRENT document before
 * draining. The collector's initial anchor is scheduled asynchronously (after
 * `waitForBody`), so a drain issued right after injecting on a navigation
 * destination beats it and returns nothing, and the destination's buffer then
 * dies with the page. The WDIO service drains the outgoing document without
 * forcing before a page transition, which is the one caller of `false`.
 */
export function collectorDrainExpression(forceAnchor = false): string {
  const call = forceAnchor
    ? 'window.wdioTraceCollector.captureCurrentDom();'
    : ''
  return `if (!(${COLLECTOR_READY_EXPRESSION})) { return null; } ${call} return window.wdioTraceCollector.getTraceData();`
}

/**
 * Captures Performance API data, cookies and document info from the page under
 * test. A string so the browser-only types (PerformanceEntry, Document) never
 * reach the Node-side type-checker. Returns the bag core's
 * `applyPerformanceData` shapes onto a command row.
 */
export const CAPTURE_PERFORMANCE_SCRIPT = `
  return (function() {
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

/** Body of {@link PAGE_SCRIPTS_API}: each a script body for an
 *  `executeScript`-style call. The drain is the forced-anchor one, which is
 *  what every adapter outside the WDIO service runs. */
export interface PageScriptsResponse {
  collectorReady: string
  collectorInject: string
  collectorDrain: string
  capturePerformance: string
}

/** The envelope the route serves, built from the constants above so it cannot
 *  differ from what the JS adapters run. */
export function buildPageScripts(): PageScriptsResponse {
  return {
    collectorReady: COLLECTOR_READY_SCRIPT,
    collectorInject: COLLECTOR_INJECT_SCRIPT,
    collectorDrain: collectorDrainExpression(true),
    capturePerformance: CAPTURE_PERFORMANCE_SCRIPT
  }
}
