---
'@wdio/devtools-service': minor
'@wdio/selenium-devtools': minor
'@wdio/nightwatch-devtools': minor
---

The artifacts manifest now carries the run's `runId`, the parent trace context from `TRACEPARENT` when set, the `cwd` and browser name, version and platform, and an `attempts[]` list per test. Each attempt entry holds a trace and span id minted when the attempt starts, and its own `error`. Attempt numbers no longer repeat within a worker, and a `specFileRetries` rerun starts at its real attempt, so `on-first-retry` now retains a rerun's trace and `retain-on-first-failure` does not.
