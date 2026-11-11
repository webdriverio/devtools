---
'@wdio/devtools-service': minor
'@wdio/selenium-devtools': minor
'@wdio/nightwatch-devtools': minor
---

The artifacts manifest (`devtools-artifacts-<sessionId>.json`) now carries each test's start and end time and framework-reported duration, and the failure message of its final attempt, so reporters can build a per-test record without opening the trace zip. The WebdriverIO service writes Cucumber scenario durations from wall-clock time, since WDIO's Cucumber duration is only the nanoseconds field of the worst step.
