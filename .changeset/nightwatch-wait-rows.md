---
'@wdio/nightwatch-devtools': patch
---

A `waitUntil` or `waitForElement*` is one row that shows as running while it waits, and the commands a `waitUntil` condition issues are nested under it, collapsed, in the live dashboard and the trace, with a wait inside a condition nested in turn. A timed-out `waitForElement*` row is marked failed while the test runs, not only in the trace.
