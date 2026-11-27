---
paths:
  - "packages/core/src/{bidi,appium-interceptor,request-type,net}.ts"
  - "packages/script/src/{collector,index}.ts"
  - "packages/script/src/collectors/**"
  - "packages/trace/src/{trace-network,trace-har}.ts"
  - "packages/nightwatch-devtools/src/{session,session-init}.ts"
  - "packages/nightwatch-devtools/src/helpers/perfLogs.ts"
  - "packages/shared/src/types.ts"
  - "packages/shared/src/browser-schemes.ts"
---

# Network capture

Three sources: driver-side (BiDi, Nightwatch's Chrome performance log), the collector's patched fetch/XHR (the only source with bodies), and the page's Resource Timing buffer (the floor).

## Rules

- Do not gate Resource Timing collection (`script/src/collectors/resourceTiming.ts`) on browser or capability. Why: it is the only network source without BiDi (Safari, every Appium session).
- Do not record a failed patched fetch/XHR as a failed row. Why: tried and reverted; beside BiDi's row each blocked beacon was listed twice (Nightwatch example, 35 to 67 failure rows). Keep the call's held Resource Timing entry instead (`NetworkRequestCollector.#releaseClaim` returns it to the list); it is the request's only record.
- Hold a Resource Timing entry that arrives before its patched call answers until the call records it or drops it (`collectors/networkRequests.ts` `consumeClaim`). Why: the request keeps one record.
- Do not treat a requested performance-log capability as proof the log is served. Why: a capability can name a log the driver never serves (XCUITest). Overlay each log entry onto the page's row for that load (`perfLogs.ts` `upgradeResourceTimingRows`), keeping the row's id, clock and phases. Why for the overlay: the log's monotonic clock only diffs within a session, so log rows are dated from CDP `wallTime`.
- Pair a log-listed load through `loadsListedByLog`, spent per load by `withoutLoadsTheLogListed`, and clear it at the next driver drain and in `armReplacedSession`. Why: a scan of the session's rows dropped a second request to the same URL (a 204 after a JSON response lost its only row); a load kept longer takes the row of the next request to that URL.
- Keep the first collector: a second bundle evaluation reuses `window.wdioTraceCollector` (`script/src/collector.ts`) and skips the setup gated on `alreadyInstalled` (`script/src/index.ts`: body wait, initial DOM capture, observer). Why: a replacement dropped buffered loads; Nightwatch injecting twice on Android Chrome via Appium gave 0 network rows.
- Make each `core/bidi.ts` request and response handler ignore the other's events by shape (`response` present or absent; the fetch-error handler by `errorText`). Why: `NetworkInspector` hands every event to every subscriber; unguarded, every request in a Selenium Chrome trace was listed twice.
- Key rows by request id (`MAX_TRACKED_REQUESTS`); a request for a known id reopens its row under the first hop's clock. Why: a redirect hop re-sends under the same id.
- Close a failed BiDi fetch as status 0 with the browser's `errorText`, through the inspector's `fetchError` hook (`subscribeFetchErrors`). Why: otherwise every blocked beacon stays pending for the session.
- Write Resource Timing rows with `NETWORK_CAPTURE_SOURCE.RESOURCE_TIMING` (`shared/src/types.ts`), method `''` unless the load is parser-initiated (`GET`), and let the HAR writer add `_source`/`_resourceType`. Why: HAR's required `status` is written as 0, which reads back as a transport failure.
- Read native app traffic only through `NativeNetworkCapture` (`core/appium-interceptor.ts`), throttling per-command drains to `NATIVE_NETWORK_DRAIN_INTERVAL_MS`; test-end and session-end drains are never throttled. Why: every read returns the whole history, bodies included.
- Read browser-own schemes (`chrome-native:` included) only from `shared/src/browser-schemes.ts`. Why: core's injection gate and the collector's request filter drifted when they kept separate lists.

## Accepted residuals (not regressions)

- Without BiDi, a failed patched call reads as `unknown`, not failed.
- Chrome: the log also lists patched fetch/XHR calls, and the ledger can spend on another request to the same URL; the cost is a row's shape, not a request.
- Python and selenium-devtools withhold the page batch once BiDi serves (bodies lost); the service keeps patched rows beside BiDi's.
- A drain before a page's first BiDi event can pass that page's rows once; Nightwatch clears its flags at session rotation, so loads before re-attach can be listed twice.
- Native: no timing (stamped at first read); launch traffic before the listener starts is not listed.
