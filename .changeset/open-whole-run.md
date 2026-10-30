---
'@wdio/devtools-app': minor
'@wdio/devtools-backend': minor
---

The trace player opens several traces at once. `show-trace` accepts several zips or a folder (`npx show-trace test-results/`), and the hosted player takes several zips through its Open button, or zips and folders dropped on the page. The player then lists every trace beside the timeline, one row per test with its outcome, failures first and then in run order, and plays the one picked without reloading. With `traceGranularity: 'test'` a run is a folder of per-test zips, so the whole run opens in one go. A zip records no test state, so the outcome is read from the trace: failed when an action or step failed, passed when it holds actions and none failed, unknown when it holds none. Files in the folder that are not zips are skipped, and a zip that cannot be opened is listed with the reason without stopping the rest. Opening a single zip works exactly as before.
