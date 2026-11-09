---
'@wdio/devtools-service': minor
'@wdio/selenium-devtools': minor
'@wdio/nightwatch-devtools': minor
---

The artifacts manifest now carries the run's `runId`, the parent trace context from `TRACEPARENT` when set, and an `attempts[]` list per test whose entries hold a trace and span id minted when the attempt starts.
