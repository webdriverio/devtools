# script — design notes and known debt

Owns the collector bundle injected into the page under test (`packages/script/src`).

## Rules

- Trace-mode drains pass the `resourceUrlKey`s already stored (`collectorDrainExpression`; FNV-1a, mirrored in Python) so a later document does not read or ship them again.
- The collector's own stylesheet and font re-reads must not show as network rows. The collector claims its Resource Timing entry; the driver-side row is dropped by `withoutResourceReReads` (`trace/src/trace-network.ts`) using URL, `wallTime` and `Sec-Fetch-Dest`. Don't drop a row without `wallTime`: an unidentifiable read should show as a second row rather than hide a real load.
- The writer stores only what the DOM stream references, resolved against `<base href>` (`shared/document-base.ts`, `shared/css-urls.ts`), capped by `PAGE_RESOURCE_LIMITS`.

## Known debt

- **A read's start and `wallTime` come from different clocks.** The read's start is `performance.timeOrigin + now()`, the browser's event clock is `wallTime`. They agree on one machine but can drift after host sleep. Also, a page's own `fetch()` of a stylesheet at read time can be mistaken for the read. Where: `withoutResourceReReads`.
